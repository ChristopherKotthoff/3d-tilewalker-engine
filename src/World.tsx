import { createRef, memo, Suspense, useContext, useEffect, useMemo, useRef } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { Group, DirectionalLight, Object3D, Raycaster, Vector3, MathUtils } from "three";
import {
  TilesRenderer,
  TilesPlugin,
  TilesRendererContext,
} from "3d-tiles-renderer/r3f";
import {
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  UnloadTilesPlugin,
} from "3d-tiles-renderer/plugins";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";

// The <TilesPlugin> ref receives the constructed plugin *instance* at runtime,
// but its TS type says "constructor" — so we ref them loosely and use the
// instance types where we call methods.
type ReorientationPluginImpl = InstanceType<typeof ReorientationPlugin>;

import { Sky } from "@react-three/drei";
import { useGame, radar } from "./store";
import { latLngToWorld, worldToLatLng } from "./geo";
import { Glow } from "./Glow";
import { Character, type Gait } from "./Character";
import { Companion } from "./Companion";
import { Car } from "./Car";
import { Vehicle } from "./Vehicle";
import { Sound, type SoundAnchors } from "./Sound";
import type { LatLng } from "./types";

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

// Camera follow offset (distance/height behind the character), in metres.
const CAM_DIST = 10; // default/initial zoom distance
const CAM_DIST_MIN = 2; // wheel-zoom clamp: don't clip into the character
const CAM_DIST_MAX = 120; // …or drift so far the character is a speck
const CAM_UP_RATIO = 0.6; // vertical offset as a fraction of distance (was 6/10)
const EYE_HEIGHT = 1.7;
const RUN_MULTIPLIER = 2.2; // Shift = run
const TURN_RATE = 7; // how fast the character rotates to face its movement dir
const CAM_RECENTER_RATE = 1; // how fast the camera swings behind heading while moving (0 = never)
const LOOK_HOLD_SECONDS = 1.5; // pause auto-recenter this long after the player mouse-looks
const CAM_DEADZONE = 2.6; // metres the character may roam within before the camera trails
const CAM_FOLLOW_RATE = 3; // camera position lag; lower = looser trailing
const RAY_UP = 400; // start the down-ray this high above the player
const RAY_DOWN = 2000; // and shoot this far down
const MAX_CLIMB = 1.5; // max walkable ground rise per horizontal metre (~45°); steeper = wall
const STEP_TOLERANCE = 1; // m of instant rise allowed regardless of slope (curbs, stairs)
// Fallback grounding probe: if the centre column is a coarse-LOD hole, sample
// these offsets (metres) in 8 compass directions and take the nearest hit.
const GROUND_PROBE_RINGS = [6, 20, 60, 150];
const GROUND_PROBE_DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
] as const;
// Post-teleport the destination IS the origin. If the origin down-ray misses but
// the nearest loaded tile is within this radius, it's just a gap in the exact
// centre column — snap onto it. Farther than this and we keep XZ at the origin
// (only borrowing the tile's height) so a coarse-LOD tile km away can't strand
// the player (Bug 1). Roughly a couple of city blocks.
const ORIGIN_SNAP = 40;
// Post-teleport, only lift the veil once the origin ground surface has stopped
// rising frame-to-frame (finer tiles refine upward as they stream) — so the player
// isn't revealed still under the mesh (Bug 2). Metres of allowed rise per frame.
const SETTLE_EPS = 0.15;
const CAR_SPEED_MULT = 4.4; // driving is faster than running
const CAR_ENTER_DIST = 4; // metres: how close to the car before E enters it
const COMPANION_GAP = 3.5; // metres Chris keeps behind the player before he moves
const COMPANION_RUN_GAP = 9; // …and beyond this he breaks into a run to catch up
const COMPANION_SPEED = 6; // Chris's own top speed (m/s) closing the gap
// Mouse-look pitch clamp (radians): don't let the camera flip over/under.
const PITCH_MIN = -0.4;
const PITCH_MAX = 1.2;

// Shared refs to plugin instances so WorldLogic can re-center on teleport and
// read attribution. Typed `any` because <TilesPlugin>'s ref type is the plugin
// *constructor*, while at runtime we receive the instance.
const reorientRef = createRef<any>();
const authRef = createRef<any>();

// memo: the tiles subtree must render exactly once. <TilesPlugin> compares
// `args` by identity and disposes+re-registers the plugin when it changes —
// re-registering mid-stream corrupts the TilesRenderer and freezes the frame
// loop. World takes no props, so memo pins it against App's game-state renders.
export const World = memo(function World() {
  const config = useGame((s) => s.config)!;
  // Reorient to where the RESUMED stage begins, not always quest[0] (Feature 1).
  // Read stageIndex NON-REACTIVELY: reorientArgs feeds <TilesPlugin>, whose args
  // are identity-compared — a reactive change mid-play would dispose+re-register
  // the ReorientationPlugin and freeze the frame loop (see docs/architecture.md). Same
  // stage-start lookup as devJumpToStage: own spawn (stage 0), else prev stage's
  // teleportTo, else prev stage's target.
  const startIndex = useGame.getState().stageIndex;
  const startStage = config.quest[startIndex];
  const prevStart = config.quest[startIndex - 1];
  const storySpawn = startStage.spawn ?? (prevStart ? prevStart.teleportTo ?? prevStart.target : startStage.target);
  // Nav mode: orient the tileset at the nav start, not the saved stage's spawn.
  // This avoids any teleport — the world just begins at the right place.
  const navStart = useGame.getState().navStart;
  const spawn = (useGame.getState().navMode && navStart) ? navStart : storySpawn;

  // Stable identities for plugin args (see note above).
  const authArgs = useMemo(() => [{ apiToken: API_KEY }], []);
  const reorientArgs = useMemo(
    () => [
      {
        lat: MathUtils.degToRad(spawn.lat),
        lon: MathUtils.degToRad(spawn.lng),
        height: 0,
      },
    ],
    [spawn.lat, spawn.lng],
  );

  return (
    <TilesRenderer
      // higher errorTarget => lower detail, faster streaming (design §10)
      errorTarget={config.settings.errorTarget ?? 24}
    >
      <TilesPlugin ref={authRef} plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin ref={reorientRef} plugin={ReorientationPlugin} args={reorientArgs} />
      <TilesPlugin plugin={TileCompressionPlugin} />
      <TilesPlugin plugin={UnloadTilesPlugin} />
      <WorldLogic />
    </TilesRenderer>
  );
});

// Consumes the tiles instance from context: drives the player, camera, glow
// placement, the arrival trigger, and the teleport re-centering.
function WorldLogic() {
  const tiles = useContext(TilesRendererContext) as TilesRendererImpl | null;
  const { camera, scene } = useThree();

  const config = useGame((s) => s.config)!;
  // For rendering the glow's colour/style we track stageIndex reactively.
  // NB: inside useFrame we deliberately re-read the stage from the store live —
  // R3F's frame loop can hold a stale render closure under StrictMode, which
  // would otherwise freeze the glow's *position* on stage 0.
  const renderStageIndex = useGame((s) => s.stageIndex);
  const renderStage = config.quest[renderStageIndex];
  // Feature 2: reactively mount the car when summoned (safe — only re-renders the
  // portal children, not the TilesRenderer/TilesPlugin subtree).
  const carSummoned = useGame((s) => s.carSummoned);
  // Nav mode: navTarget going null (beacon dismissed) must hide the Glow — subscribe reactively.
  const navBeaconActive = useGame((s) => s.navMode && s.navTarget !== null);

  const player = useRef<Group>(null);
  const attribFrame = useRef(0);
  const heading = useRef(0); // character yaw, radians
  const groundY = useRef(0); // last known ground height
  const gait = useRef<Gait>("idle");
  const glowPos = useRef(new Vector3());
  const teleportWait = useRef(0); // seconds spent waiting for destination ground to stream
  const settleY = useRef<number | null>(null); // last frame's origin ground height, to detect it's stopped rising
  const handledSeq = useRef(0); // last teleportSeq we re-centered on (see the frame loop)
  const handledSummonSeq = useRef(0); // last carSummonSeq we parked a car for (Feature 2)
  // Car + companion.
  const car = useRef<Group>(null);
  const carPos = useRef(new Vector3(3, 0, 3)); // world spot the car sits at
  const carHeading = useRef(0);
  const companion = useRef<Group>(null);
  const companionPos = useRef(new Vector3(-2, 0, 2));
  const companionHeading = useRef(0);
  const companionGait = useRef<Gait>("idle");
  const companionGroundY = useRef(0); // Chris's own ground height (his own ray, not the player's)
  // Chris's goal: null → follow the player; a Vector3 → walk to that fixed world spot.
  const companionGoal = useRef<Vector3 | null>(null);
  const prevStage = useRef(-1); // last frame's stage index (detect stage entry)
  const companionVisible = useRef(true); // stage "hidden" → Chris not present
  const companionClip = useRef<string | null>(null); // stage-forced idle clip (dance/wave/sit)
  const sun = useRef<DirectionalLight>(null); // shadow-casting key light, trails the player
  // GTA-style orbit camera: yaw/pitch are absolute (mouse-driven), the character
  // moves relative to the camera and turns to face its motion.
  const camYaw = useRef(Math.PI); // start looking along the character's forward (-Z)
  const camPitch = useRef(0.35);
  const camDist = useRef(CAM_DIST); // wheel-adjusted zoom distance
  const camTarget = useRef(new Vector3()); // anchor the camera orbits (trails player w/ dead-zone)
  const lookHold = useRef(0); // seconds remaining to suppress auto-recenter after mouse-looking

  // Anchors the soundscape follows (moving entities + the active beacon).
  const soundAnchors = useMemo<SoundAnchors>(
    () => ({ player, companion, car, beacon: glowPos }),
    [],
  );

  const keys = useKeys();
  useMouseLook(camYaw, camPitch, camDist, lookHold);
  const raycaster = useMemo(() => new Raycaster(), []);
  const down = useMemo(() => new Vector3(0, -1, 0), []);
  const rayOrigin = useMemo(() => new Vector3(), []);
  const scratch = useMemo(() => new Vector3(), []); // H-reset start-of-level lookup

  // Dev aid: expose tiles instance + player for debugging in the console, plus a
  // full scene snapshot the Debug panel's REMEMBER button reads.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__tiles = tiles;
      (window as any).__player = player.current;
      (window as any).__glow = glowPos.current;
      // set to a {x,z} to send Chris to a fixed spot, null to follow the player
      (window as any).__chrisGoal = (p: { x: number; z: number } | null) =>
        (companionGoal.current = p ? new Vector3(p.x, 0, p.z) : null);
      (window as any).__cam = () =>
        ({ yaw: +camYaw.current.toFixed(3), heading: +heading.current.toFixed(3), hold: +lookHold.current.toFixed(2) });
      (window as any).__raytest = () => {
        rayOrigin.set(player.current!.position.x, 10000, player.current!.position.z);
        raycaster.set(rayOrigin, down);
        raycaster.far = 20000;
        const hits = raycaster.intersectObject(tiles!.group, true);
        return { n: hits.length, y: hits[0]?.point.y ?? null, groundY: groundY.current, loadProgress: tiles!.loadProgress };
      };
      (window as any).__debugSnapshot = () => {
        const p = player.current?.position ?? new Vector3();
        const ll = tiles ? worldToLatLng(tiles, p) : { lat: 0, lng: 0 };
        const s = useGame.getState();
        return {
          player: { lat: ll.lat, lng: ll.lng, x: p.x, y: p.y, z: p.z },
          heading: heading.current,
          camera: {
            x: camera.position.x, y: camera.position.y, z: camera.position.z,
            yaw: camYaw.current, pitch: camPitch.current, dist: camDist.current,
          },
          stageIndex: s.stageIndex,
          phase: s.phase,
          inCar: s.inCar,
          heightOffset: s.heightOffset,
        };
      };
    }
  }, [tiles, camera]);

  // The ReorientationPlugin recenters the spawn lat/lon onto the world origin,
  // so the player simply starts at (0,0,0). (Glows are placed as offsets from
  // this origin via latLngToWorld.)
  useEffect(() => {
    if (!tiles || !player.current) return;
    player.current.position.set(0, groundY.current, 0);
    camera.far = 1_000_000;
    camera.near = 1;
    camera.updateProjectionMatrix();

    // Cap tile memory so long sessions / far teleports (Zürich…) don't grow
    // unbounded. Defaults are ~0.4 GB / 8000 tiles; we hold a tighter budget and
    // unload unused tiles more aggressively.
    const c = tiles.lruCache;
    c.minBytesSize = 0.15 * 1024 ** 3;
    c.maxBytesSize = 0.3 * 1024 ** 3;
    c.minSize = 2500;
    c.maxSize = 4500;
    c.unloadPercent = 0.15;

    // Let streamed tiles receive the character shadows as they load in.
    const onLoad = (e: { scene: Object3D }) => {
      e.scene.traverse((o: any) => {
        if (o.isMesh) o.receiveShadow = true;
      });
    };
    tiles.addEventListener("load-model", onLoad as any);
    return () => tiles.removeEventListener("load-model", onLoad as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles]);

  // After a teleport re-center, the destination is again the world origin.
  const warpTo = (_to: LatLng) => {
    if (!player.current) return;
    player.current.position.x = 0;
    player.current.position.z = 0;
    heading.current = 0;
    camTarget.current.set(0, groundY.current + EYE_HEIGHT, 0); // don't trail from the old spot
    // Bring Chris and the car to the destination too (their old world coords are
    // meaningless after the re-center) so they don't stream in from off-world.
    companionPos.current.set(-2, groundY.current, 2);
    companionGoal.current = null;
    carPos.current.set(3, groundY.current, 3);
  };

  // Re-center the tileset at a teleport destination and move everyone to the new
  // origin. Called from the frame loop (NOT a React effect) the moment a new
  // teleportSeq appears — so a fast same-city warp, whose ground is already
  // loaded, can't call finishTeleport() and flip phase back to "playing" before
  // the recenter runs. (That race left same-city jumps stuck at the old origin.)
  const applyTeleport = (to: LatLng) => {
    if (!tiles) return;
    const plugin = reorientRef.current as ReorientationPluginImpl | null;
    if (plugin) {
      plugin.transformLatLonHeightToOrigin(
        MathUtils.degToRad(to.lat),
        MathUtils.degToRad(to.lng),
        0,
      );
    }
    warpTo(to);
    useGame.getState().setGroundReady(false);
    // Drop the origin location's tiles so a far warp doesn't keep both cities in
    // memory (mark everything unused, then unload past the min budget).
    tiles.lruCache.markAllUnused();
    tiles.lruCache.unloadUnusedContent();
  };

  useFrame((_, delta) => {
    if (!tiles || !player.current) return;
    const st = useGame.getState();
    const stage = config.quest[st.stageIndex];
    const pos = player.current.position;
    // Lift the grounded characters out of the street mesh (tiles often ground a
    // touch below the visual floor). Live-tunable in the debug panel.
    const yOff = st.heightOffset;

    // ---- Teleport re-center (frame-ordered, so it always runs before the
    // ground-lock below can finishTeleport). A new teleportSeq means a warp was
    // requested since we last handled one — apply it now, then reset the wait. --
    if (st.teleportSeq !== handledSeq.current && st.teleportTo) {
      handledSeq.current = st.teleportSeq;
      applyTeleport(st.teleportTo);
      teleportWait.current = 0;
      settleY.current = null; // fresh settle-height tracking for this warp
      return; // next frame streams/grounds the destination
    }

    // ---- Raycast snap to ground ----
    // Two modes. Locked (normal walking): a tight ray from just above the known
    // ground rides the surface cheaply. Unlocked (spawn / just after a teleport):
    // the last groundY is stale — a far warp lands in a city at a totally
    // different elevation (Zürich sits ~450 m above the ellipsoid where we
    // recenter, a sea-level city ~0) — so sweep from a fixed high altitude that brackets
    // any terrain on Earth. If a locked tight ray ever *misses* (walked off a data
    // cliff, or landed low), fall back to the sweep so groundY self-heals.
    const rayAt = (ox: number, oz: number, h: number, far: number) => {
      rayOrigin.set(pos.x + ox, h, pos.z + oz);
      raycaster.set(rayOrigin, down);
      raycaster.far = far;
      const hits = raycaster.intersectObject(tiles.group, true);
      return hits.length ? hits[0].point.y : null;
    };
    // Like rayAt, but returns the hit closest to the player's current ground
    // height (the surface she's standing on), not the topmost one — so a tunnel
    // ceiling or overhang above her doesn't read as ground/wall. Used while
    // walking (locked). Lets her pass through openings a solid wall still blocks
    // (a building shell hits only its roof, which stays far from groundY).
    const floorNear = (ox: number, oz: number) => {
      rayOrigin.set(pos.x + ox, groundY.current + RAY_UP, pos.z + oz);
      raycaster.set(rayOrigin, down);
      raycaster.far = RAY_DOWN;
      const hits = raycaster.intersectObject(tiles.group, true);
      if (!hits.length) return null;
      let best = hits[0].point.y;
      for (const h of hits)
        if (Math.abs(h.point.y - groundY.current) < Math.abs(best - groundY.current))
          best = h.point.y;
      return best;
    };
    // The tile directly under a stationary player can be a coarse-LOD hole (the
    // "data cliff") even when the city is loaded — so if the centre column misses,
    // sample a small spiral and take the nearest hit. Keeps spawn/teleport from
    // hanging forever over a gap, and gives a sensible standing height.
    const groundNear = (h: number, far: number) => {
      const c = rayAt(0, 0, h, far);
      if (c !== null) return c;
      for (const r of GROUND_PROBE_RINGS) {
        for (const [sx, sz] of GROUND_PROBE_DIRS) {
          const y = rayAt(sx * r, sz * r, h, far);
          if (y !== null) return y;
        }
      }
      return null;
    };
    if (!st.groundReady) {
      // sweep from an altitude that brackets any terrain on Earth (a far warp can
      // land in a city hundreds of metres above the ellipsoid we recenter on)
      let y = groundNear(10000, 20000);
      const originHit = y !== null; // is there real geometry under the destination?
      teleportWait.current += delta;
      // A far teleport sometimes refines geometry *offset* from the origin (the
      // exact origin column lags), leaving nothing under the player. Post-recenter
      // the destination IS the world origin, so we must NOT relocate the player
      // onto a distant coarse-LOD tile's sphere centre (that stranded her a few km
      // away — Bug 1). Keep XZ pinned at the origin; use nearestGroundXZ only to
      // *estimate a floor height* so she doesn't sink, and only after a grace so the
      // origin column has a chance to refine first. The veil stays up until origin
      // geometry is genuinely present (Bug 2), so a Y-estimate here is transient.
      if (y === null && teleportWait.current > 5) {
        const near = nearestGroundXZ(tiles, pos);
        // ponytail: if the nearest tile is basically over us (origin column effectively
        // resolved, just a gap in the exact centre ray), snap onto it; otherwise leave
        // XZ at the origin and only borrow its height as a standing estimate.
        if (near) {
          if (Math.hypot(near.x - pos.x, near.z - pos.z) < ORIGIN_SNAP) {
            pos.x = near.x;
            pos.z = near.z;
            y = groundNear(near.y + 2000, 4000) ?? near.y;
          } else {
            groundY.current = near.y; // floor estimate; XZ stays at origin
          }
        }
      }
      // Bug 2: finer tiles stream in AFTER loadProgress reads high, often at a
      // *higher* surface than a coarse tile — lifting the veil then leaves the player
      // briefly under the mesh. So on the "nice" path require the origin height to
      // have settled: real geometry present (originHit), the city mostly loaded,
      // AND this frame's origin surface no longer rising vs. the last (within
      // SETTLE_EPS). The 8s net still force-locks so a slow refine can't hang.
      const prevY = settleY.current;
      if (originHit) settleY.current = y!;
      const settled = prevY !== null && y! - prevY < SETTLE_EPS;
      if (originHit && ((tiles.loadProgress >= 0.95 && settled) || teleportWait.current > 8)) {
        groundY.current = y!; // snap; don't float in from the stale height
        st.setGroundReady(true);
        teleportWait.current = 0;
        if (st.phase === "teleporting") st.finishTeleport();
      } else if (teleportWait.current > 12) {
        // ponytail: hard failsafe — resume after 12s so a teleport can never hang.
        // If origin geometry never refined (originHit false), lock at whatever floor
        // estimate we have (groundY, seeded above from the nearest tile's height)
        // WITHOUT moving XZ off the origin — the locked walking ray self-heals the
        // height once tiles stream in, and she's still standing on the true target.
        // Ceiling: for the ~12s window on a very slow far warp she may float over a
        // gap at an estimated height; acceptable vs. being stranded km away.
        if (originHit) groundY.current = y!;
        st.setGroundReady(true);
        teleportWait.current = 0;
        if (st.phase === "teleporting") st.finishTeleport();
      }
    } else {
      let y = floorNear(0, 0);
      if (y === null) y = groundNear(10000, 20000); // self-heal on a miss
      if (y !== null) {
        // smooth toward the hit so LOD "data cliffs" become slopes, not jumps
        groundY.current = MathUtils.damp(groundY.current, y, 8, delta);
      }
    }
    pos.y = groundY.current + yOff;

    // ---- Summon a car beside the player (C key / debug — Feature 2) ----
    // Bumped carSummonSeq means a summon was requested since we last parked one;
    // drop the car a couple of metres beside the player, then it drives normally.
    if (st.carSummonSeq !== handledSummonSeq.current) {
      handledSummonSeq.current = st.carSummonSeq;
      carPos.current.set(pos.x + 2.5, groundY.current, pos.z + 2.5);
      carHeading.current = heading.current;
    }

    // ---- Enter / exit the car (edge-triggered E) ----
    const canMove = st.phase === "playing" && st.groundReady;
    // ponytail: the car only exists on car stages (or when summoned); off them E
    // does nothing and any leftover inCar can't persist (the player stays visible below).
    const usesCar = stage.vehicle === "car" || st.carSummoned;
    if (!usesCar && st.inCar) st.setInCar(false);
    if (keys.current.enterPressed) {
      keys.current.enterPressed = false;
      if (canMove && usesCar) {
        if (st.inCar) {
          // Park the car where we are, step the player aside so she isn't inside it.
          carPos.current.set(pos.x, groundY.current, pos.z);
          carHeading.current = heading.current;
          pos.x += Math.cos(heading.current) * 2.2;
          pos.z += -Math.sin(heading.current) * 2.2;
          st.setInCar(false);
        } else {
          const d = Math.hypot(pos.x - carPos.current.x, pos.z - carPos.current.z);
          if (d < CAR_ENTER_DIST) {
            // Hop in: drive from the car's spot.
            pos.x = carPos.current.x;
            pos.z = carPos.current.z;
            st.setInCar(true);
          }
        }
      }
    }
    const inCar = st.inCar;

    // ---- Help (H): reset the player to where this level started ----
    // "Start" = where the stage begins: its own spawn (stage 0), else the previous
    // stage's teleport destination (post-warp that's the current origin), else the
    // previous glow's spot in this city. Same lookup as devJumpToStage; run through
    // latLngToWorld so an in-city start (prev.target) lands correctly. Ground Y
    // self-heals via the walking ray next frame.
    if (keys.current.helpPressed) {
      keys.current.helpPressed = false;
      if (st.phase === "playing" && !inCar) {
        const prev = config.quest[st.stageIndex - 1];
        const start =
          stage.spawn ??
          (prev ? prev.teleportTo ?? prev.target : stage.target);
        latLngToWorld(tiles, start, 0, scratch);
        pos.x = scratch.x;
        pos.z = scratch.z;
        heading.current = 0;
        camTarget.current.set(pos.x, groundY.current + EYE_HEIGHT, pos.z);
      }
    }

    // ---- Google Maps walking directions (G): open a tab from the player's current
    // position to the current target. worldToLatLng inverts the recenter. ----
    if (keys.current.mapPressed) {
      keys.current.mapPressed = false;
      const from = worldToLatLng(tiles, pos);
      const to = stage.target;
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}` +
          `&destination=${to.lat},${to.lng}&travelmode=walking`,
        "_blank",
      );
    }

    // ---- Movement: camera-relative (GTA-style) ----
    // W/S run along the camera's view axis, A/D strafe. The character rotates to
    // face wherever it's actually moving; the camera's yaw is mouse-only. Driving
    // is the same controls, just faster.
    let nextGait: Gait = "idle";
    if (canMove) {
      const fwdIn = (keys.current.fwd ? 1 : 0) - (keys.current.back ? 1 : 0);
      const strafeIn = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
      if (fwdIn !== 0 || strafeIn !== 0) {
        const yaw = camYaw.current;
        // forward = away from the camera; right = perpendicular on the ground plane
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        let mx = fx * fwdIn + rx * strafeIn;
        let mz = fz * fwdIn + rz * strafeIn;
        const len = Math.hypot(mx, mz) || 1;
        mx /= len; mz /= len;

        const running = keys.current.run;
        const mult = inCar ? CAR_SPEED_MULT : running ? RUN_MULTIPLIER : 1;
        const d = config.settings.moveSpeed * mult * delta;
        pos.x += mx * d;
        pos.z += mz * d;
        // Wall collision: probe the ground at the intended new spot. If it rises
        // faster than a walkable slope for the distance moved this frame (a
        // near-vertical building face), cancel the step so she bumps the wall
        // instead of running up it. MAX_CLIMB (rise/run ≈ tan) keeps ~45° hills
        // walkable; STEP_TOLERANCE lets curbs/stairs through regardless of slope.
        // ponytail: naive single down-ray probe — no thickness/side sweep, so a
        // thin overhang or a wall thinner than one frame's travel can slip past.
        if (!inCar && st.groundReady) {
          const ahead = floorNear(0, 0);
          if (ahead !== null &&
              ahead - groundY.current > STEP_TOLERANCE + MAX_CLIMB * d) {
            pos.x -= mx * d;
            pos.z -= mz * d;
          }
        }
        nextGait = running ? "run" : "walk";

        // Turn the character toward its motion (shortest angular path).
        const desired = Math.atan2(-mx, -mz);
        let diff = desired - heading.current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        heading.current += diff * Math.min(1, TURN_RATE * delta);
      }
      player.current.rotation.y = heading.current;
    }
    gait.current = nextGait;

    // ---- Car + companion placement ----
    // While driving, the car rides under the player and the player is hidden; parked,
    // it stays where it was left. Chris trails a few metres behind and dances when
    // he catches up (his glb has no idle clip).
    player.current.visible = !inCar; // inCar is false off car stages (gated above)
    // ponytail: on entering a car stage, park the car a couple of metres beside
    // the player so it's ready to board — not left at the meaningless (3,3).
    if (usesCar && prevStage.current !== st.stageIndex) {
      carPos.current.set(pos.x + 2.5, groundY.current, pos.z + 2.5);
      carHeading.current = heading.current;
    }
    if (inCar) {
      carPos.current.set(pos.x, groundY.current, pos.z);
      carHeading.current = heading.current;
    }
    if (car.current) {
      car.current.visible = usesCar; // ponytail: hidden on non-car stages
      car.current.position.copy(carPos.current);
      car.current.rotation.y = carHeading.current;
    }
    // Show the "E to enter" prompt only when a boardable car is in range (and not
    // already driving). Write the store only on change so the UI doesn't churn.
    const carNear =
      usesCar && !inCar &&
      Math.hypot(pos.x - carPos.current.x, pos.z - carPos.current.z) < CAR_ENTER_DIST;
    if (carNear !== st.carNear) st.setCarNear(carNear);
    // ---- Per-stage companion role (from game.json) ----
    // "hidden" → Chris absent. "follow" (or unset) → trails the player. {lat,lng} →
    // walks to and waits at that fixed spot. A stage may also pin his idle clip.
    const role = stage.companion ?? "follow";
    companionVisible.current = role !== "hidden";
    companionClip.current = stage.companionClip ?? null;
    if (role === "hidden" || role === "follow") {
      companionGoal.current = null;
    } else {
      companionGoal.current ??= new Vector3();
      latLngToWorld(tiles, role, 0, companionGoal.current);
    }
    // ponytail: snap Chris to a fixed waiting spot on stage entry instead of
    // running there — reunions/meet points place him already standing there.
    const stageChanged = prevStage.current !== st.stageIndex;
    if (stageChanged && companionGoal.current) {
      companionPos.current.x = companionGoal.current.x;
      companionPos.current.z = companionGoal.current.z;
      companionGait.current = "idle";
    }
    prevStage.current = st.stageIndex;

    if (companion.current && companionVisible.current) {
      const cp = companionPos.current;
      // Goal is either a fixed world spot or the player. Following her, stop a gap
      // behind; heading to a fixed spot, arrive on it (stopGap 0).
      const goal = companionGoal.current ?? pos;
      const stopGap = companionGoal.current ? 0 : COMPANION_GAP;
      const dx = goal.x - cp.x;
      const dz = goal.z - cp.z;
      const gap = Math.hypot(dx, dz);
      let cGait: Gait = "idle";
      if (gap > stopGap + 0.05) {
        const ux = dx / gap, uz = dz / gap;
        // hysteresis: start running past RUN_GAP, but keep running until nearly
        // caught up (stopGap*2) so he doesn't flicker run/walk at the edge
        const running =
          gap > COMPANION_RUN_GAP ||
          (companionGait.current === "run" && gap > stopGap * 2);
        const step = COMPANION_SPEED * (running ? RUN_MULTIPLIER : 1) * delta;
        // stop at the gap edge so he doesn't pile into his goal
        const travel = Math.min(step, gap - stopGap);
        cp.x += ux * travel;
        cp.z += uz * travel;
        cGait = running ? "run" : "walk";
        const desired = Math.atan2(-ux, -uz);
        let diff = desired - companionHeading.current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        companionHeading.current += diff * Math.min(1, TURN_RATE * delta);
      }
      // Chris finds his own standing height with his own down-ray (reusing the
      // player's rayAt, offset to Chris's XZ) — not shared with the player's groundY.
      let cy = rayAt(cp.x - pos.x, cp.z - pos.z, companionGroundY.current + RAY_UP, RAY_DOWN);
      if (cy === null) cy = rayAt(cp.x - pos.x, cp.z - pos.z, 10000, 20000); // self-heal on a miss
      if (cy !== null) companionGroundY.current = cy;
      cp.y = companionGroundY.current + yOff;
      companion.current.position.copy(cp);
      companion.current.rotation.y = companionHeading.current;
      companionGait.current = cGait;
    }
    if (companion.current) companion.current.visible = companionVisible.current;

    // ---- Follow camera: orbit a trailing anchor with a dead-zone (GTA-style) --
    // The camera looks at `camTarget`, which only moves once the character
    // leaves a small radius around it — so the cam holds still for little steps
    // and trails when you actually travel. Yaw/pitch are absolute (mouse-driven).
    const anchor = camTarget.current;
    const adx = pos.x - anchor.x;
    const adz = pos.z - anchor.z;
    const adist = Math.hypot(adx, adz);
    if (adist > CAM_DEADZONE) {
      // pull the anchor to the dead-zone edge, then damp the rest for smoothness
      const edgeX = pos.x - (adx / adist) * CAM_DEADZONE;
      const edgeZ = pos.z - (adz / adist) * CAM_DEADZONE;
      anchor.x = MathUtils.damp(anchor.x, edgeX, CAM_FOLLOW_RATE, delta);
      anchor.z = MathUtils.damp(anchor.z, edgeZ, CAM_FOLLOW_RATE, delta);
    }
    anchor.y = MathUtils.damp(anchor.y, groundY.current + yOff + EYE_HEIGHT, CAM_FOLLOW_RATE, delta);

    // Auto-recenter: while moving (and not just after a manual mouse-look), swing
    // the camera yaw around to sit behind the character. The camera offset is
    // (sin yaw, cos yaw) and forward is (-sin heading, -cos heading), so "behind"
    // (offset = -forward) is exactly yaw = heading.
    lookHold.current = Math.max(0, lookHold.current - delta);
    if (nextGait !== "idle" && lookHold.current === 0 && CAM_RECENTER_RATE > 0) {
      let d = heading.current - camYaw.current;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way around
      camYaw.current += d * Math.min(1, CAM_RECENTER_RATE * delta);
    }

    const yaw = camYaw.current;
    const pitch = MathUtils.clamp(camPitch.current, PITCH_MIN, PITCH_MAX);
    const horiz = camDist.current * Math.cos(pitch);
    camera.position.set(
      anchor.x + Math.sin(yaw) * horiz,
      anchor.y + camDist.current * CAM_UP_RATIO * Math.sin(pitch),
      anchor.z + Math.cos(yaw) * horiz,
    );
    camera.lookAt(anchor.x, anchor.y, anchor.z);

    // ---- Shadow key light trails the player ----
    // A directional light's shadow frustum is small & centred on its target, so
    // move both with the player to keep crisp shadows without a city-sized map.
    if (sun.current) {
      sun.current.position.set(pos.x + 60, groundY.current + 90, pos.z + 40);
      sun.current.target.position.set(pos.x, groundY.current, pos.z);
      sun.current.target.updateMatrixWorld();
    }

    // ---- Place the active glow & test the arrival trigger ----
    const glowTarget = (st.navMode && st.navTarget) ? st.navTarget : stage.target;
    latLngToWorld(tiles, glowTarget, 0, glowPos.current);
    // snap glow base to ground under it (fallback: player's ground height)
    rayOrigin.set(glowPos.current.x, groundY.current + RAY_UP, glowPos.current.z);
    raycaster.set(rayOrigin, down);
    const gHits = raycaster.intersectObject(tiles.group, true);
    glowPos.current.y = gHits.length > 0 ? gHits[0].point.y : groundY.current;

    // Feed the minimap (plain object, not the store — see radar in store.ts).
    radar.px = pos.x; radar.pz = pos.z; radar.heading = heading.current;
    radar.camYaw = camYaw.current;
    radar.tx = glowPos.current.x; radar.tz = glowPos.current.z;
    const pll = worldToLatLng(tiles, pos); // for the minimap's satellite tiles
    radar.lat = pll.lat; radar.lng = pll.lng;

    // The orb is inert while the debug panel is open — no auto-advance/teleport
    // so you can walk onto beacons while debugging without triggering a stage.
    if (st.phase === "playing" && st.groundReady && !st.debugOpen) {
      const dx = pos.x - glowPos.current.x;
      const dz = pos.z - glowPos.current.z;
      const dist = Math.hypot(dx, dz);
      const radius = stage.triggerRadius ?? config.settings.triggerRadius;
      if (st.navMode) {
        // Nav mode: dismiss the beacon on arrival, never advance the story stage.
        if (st.navTarget && dist < radius) st.clearNavBeacon();
      } else {
        if (dist < radius) st.arrive();
      }
    }

    // ---- Attribution (mandatory) — poll ~2x/sec, not every frame ----
    if (++attribFrame.current % 30 === 0 && authRef.current) {
      const out: { value: unknown }[] = [];
      authRef.current.getAttributions(out);
      const text = out
        .map((a) => a.value)
        .filter((v): v is string => typeof v === "string")
        .join(" · ");
      if (text && text !== st.attribution) st.setAttribution(text);
    }
  });

  // Portal our own objects to the scene root. <TilesRenderer> wraps its children
  // in a group that copies tiles.group.matrixWorld (the ECEF->origin recenter),
  // which would apply that ~6.3M-metre offset a *second* time to objects already
  // authored in recentered space — pushing them off-world. The scene root has no
  // such transform, matching the camera and the rendered tiles.
  const night = !!renderStage.night;
  return createPortal(
    <>
      {/* Atmospheric sky + sun. Large distance so it reads as a real horizon.
          Night stages drop the sun below the horizon → a dark, deep-blue sky. */}
      <Sky
        distance={450000}
        sunPosition={night ? [100, -30, 100] : [100, 40, 100]}
        turbidity={night ? 12 : 6}
        rayleigh={night ? 0.4 : 1.2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />
      {/* useGLTF suspends while a glb loads; Sky/Glow keep rendering. */}
      <Suspense fallback={null}>
        <Character ref={player} gait={gait} forceClip={companionClip} />
      </Suspense>
      <Suspense fallback={null}>
        <Companion ref={companion} gait={companionGait} forceClip={companionClip} />
      </Suspense>
      {/* ponytail: the drivable car only mounts on stages whose vehicle is "car"
          (or when summoned) — like Vehicle.tsx gates its models. Otherwise it
          followed the player into every city. Frame loop still hides it via
          car.current.visible too, but not mounting it is the real fix. */}
      {(renderStage.vehicle === "car" || carSummoned) && <Car ref={car} />}
      <Sound tiles={tiles} anchors={soundAnchors} />
      {/* In nav mode, hide the beacon once dismissed (navTarget → null). Outside
          nav mode, always show the story glow. navBeaconActive is false = dismissed. */}
      {(!useGame.getState().navMode || navBeaconActive) && (
        <Glow
          positionRef={glowPos}
          color={renderStage.glowColor ?? (renderStage.glowStyle === "teleport" ? "#c77dff" : "#5fd0ff")}
          teleport={renderStage.glowStyle === "teleport"}
        />
      )}
      {/* Boardable travel model parked on the beacon (plane/bus/bike); reaching
          the beacon boards it and teleports. Trains/none render nothing. */}
      <Suspense fallback={null}>
        <Vehicle stage={renderStage} positionRef={glowPos} />
      </Suspense>
      {/* Sky fill + a hemisphere for softer, ground-tinted ambient.
          Night: dimmer, cooler moonlight fill. */}
      <ambientLight intensity={night ? 0.18 : 0.55} />
      <hemisphereLight args={night ? ["#3a4a7a", "#0a0d18", 0.35] : ["#bcd4ff", "#4a4636", 0.7]} />
      {/* Shadow-casting key light; its position/target trail the player each frame
          so a modestly-sized shadow frustum stays crisp under the characters. */}
      <directionalLight
        ref={sun}
        intensity={night ? 0.6 : 2.6}
        color={night ? "#9fb4e6" : "#fff4e2"}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-camera-near={1}
        shadow-camera-far={260}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
    </>,
    scene,
  );
}

// Rescue for a far teleport whose geometry refined offset from the origin: find
// the loaded tile mesh whose bounding-sphere centre is nearest the player in X/Z
// and return that centre. Cheap (walks already-loaded meshes; runs only during
// the post-warp settle, not every frame).
const _sphereCenter = new Vector3();
type XYZ = { x: number; y: number; z: number };
function nearestGroundXZ(tiles: TilesRendererImpl, pos: Vector3): XYZ | null {
  let best: XYZ | null = null;
  let bestD = Infinity;
  tiles.group.updateMatrixWorld(true);
  tiles.group.traverse((o: any) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const s = o.geometry.boundingSphere;
    if (!s) return;
    _sphereCenter.copy(s.center).applyMatrix4(o.matrixWorld);
    // Reject stale tiles from a previous city that haven't unloaded yet: after a
    // recenter the destination sits at the origin, so any legit tile is within a
    // few km — an ECEF-scale offset means it's the old location's leftover.
    if (Math.hypot(_sphereCenter.x, _sphereCenter.z) > 50_000) return;
    const d = Math.hypot(_sphereCenter.x - pos.x, _sphereCenter.z - pos.z);
    if (d < bestD) {
      bestD = d;
      best = { x: _sphereCenter.x, y: _sphereCenter.y, z: _sphereCenter.z };
    }
  });
  return best;
}

// Minimal keyboard state (WASD + arrows, Shift = run). `enterPressed` is an
// edge flag the frame loop consumes+clears (E to enter/exit the car). Refs so we
// don't re-render per key.
function useKeys() {
  const keys = useRef({ fwd: false, back: false, left: false, right: false, run: false, enterPressed: false, helpPressed: false, mapPressed: false });
  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      // Don't steal keystrokes while typing in an input (e.g. the debug panel).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Deactivate main-game input outside active play (minigame / letter / warp):
      // ignore key *presses*, but still process key *releases* so a key held when
      // the orb fires doesn't stay stuck down when play resumes. This is what frees
      // WASD/arrows/space for a minigame — the main game never sees them.
      if (v && useGame.getState().phase !== "playing") return;
      switch (e.code) {
        case "KeyW": case "ArrowUp": keys.current.fwd = v; break;
        case "KeyS": case "ArrowDown": keys.current.back = v; break;
        case "KeyA": case "ArrowLeft": keys.current.left = v; break;
        case "KeyD": case "ArrowRight": keys.current.right = v; break;
        case "ShiftLeft": case "ShiftRight": keys.current.run = v; break;
        case "KeyE": if (v) keys.current.enterPressed = true; break;
        case "KeyC": if (v) useGame.getState().summonCar(); break; // Feature 2: summon a drivable car
        case "KeyH": if (v) keys.current.helpPressed = true; break;
        case "KeyG": if (v) keys.current.mapPressed = true; break;
        default: return;
      }
      e.preventDefault();
    };
    const dn = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return keys;
}

// Pointer-lock mouse-look: click the canvas to capture the mouse and orbit the
// camera; Esc releases it. Scroll wheel zooms (clamped). Writes yaw/pitch/dist
// offsets applied by the follow camera.
function useMouseLook(
  yaw: React.MutableRefObject<number>,
  pitch: React.MutableRefObject<number>,
  dist: React.MutableRefObject<number>,
  lookHold: React.MutableRefObject<number>,
) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const SENS = 0.0022;
    const requestLock = () => {
      // Only grab the pointer while actively playing (so modal buttons stay usable).
      if (useGame.getState().phase === "playing") canvas.requestPointerLock();
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yaw.current -= e.movementX * SENS;
      pitch.current = MathUtils.clamp(
        pitch.current - e.movementY * SENS,
        PITCH_MIN,
        PITCH_MAX,
      );
      lookHold.current = LOOK_HOLD_SECONDS; // pause auto-recenter while the player aims
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dist.current = MathUtils.clamp(
        // proportional step: constant *feel* across the now-much-wider range
        dist.current * (1 + e.deltaY * 0.001),
        CAM_DIST_MIN,
        CAM_DIST_MAX,
      );
    };
    // ponytail: auto-manage pointer-lock across phase changes. Plain zustand
    // subscribe fires (state, prev) on every change; track prev phase ourselves.
    let prevPhase = useGame.getState().phase;
    const unsub = useGame.subscribe((state) => {
      if (state.phase === prevPhase) return;
      prevPhase = state.phase;
      if (state.phase === "playing" && !state.debugOpen) {
        // Transitions into "playing" come from button clicks (user gesture),
        // so requestPointerLock is permitted; try/catch → silent fallback.
        // Skip while the debug panel is open so a warp doesn't steal the cursor.
        if (document.pointerLockElement !== canvas) {
          try { canvas.requestPointerLock(); } catch { /* falls back to click-to-lock */ }
        }
      } else if (document.pointerLockElement === canvas) {
        document.exitPointerLock(); // free the cursor so modal buttons are clickable
      }
    });
    canvas.addEventListener("click", requestLock);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("mousemove", onMove);
    return () => {
      unsub();
      canvas.removeEventListener("click", requestLock);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("mousemove", onMove);
    };
  }, [gl, yaw, pitch, dist, lookHold]);
}
