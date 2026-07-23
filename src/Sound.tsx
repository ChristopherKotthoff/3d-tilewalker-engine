import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Audio, AudioListener, AudioLoader, PositionalAudio, Vector3 } from "three";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { useGame } from "./store";
import { latLngToWorld } from "./geo";
import type { SoundCue } from "./types";

export type SoundAnchors = {
  player: React.MutableRefObject<{ position: Vector3 } | null>;
  companion: React.MutableRefObject<{ position: Vector3; visible?: boolean } | null>;
  car: React.MutableRefObject<{ position: Vector3 } | null>;
  beacon: React.MutableRefObject<Vector3>; // the active glow's world position
};

// One audio object per cue, plus its smoothed gain and load state.
type Runtime = {
  cue: SoundCue;
  positional: boolean;
  sound: Audio | PositionalAudio;
  loaded: boolean;
  gain: number; // current (smoothed) gain — ramps toward the per-frame target
  fired: boolean; // one-shot triggers: already played (arrival) / currently in range (proximity)
  buffers?: AudioBuffer[]; // `pool` cues: the loaded random clips
  timer?: number; // `pool` cues: seconds until the next random clip plays
  lastIdx?: number; // `pool` cues: last-played index (avoid immediate repeat)
};

const _anchor = new Vector3();
const loader = new AudioLoader();
const randRange = (r?: [number, number]) => {
  const [a, b] = r ?? [15, 20];
  return a + Math.random() * (b - a);
};

// The soundscape. Reads cues from game.json (config.sounds) and realises each as
// an ambient (non-positional) or positional Three.js audio node. Every cue fades
// its gain toward a per-frame target, so entering/leaving a stage, walking near a
// point/entity, or arriving at a beacon all start and end smoothly. General: add
// a cue to game.json, no code change. See types.ts `SoundCue` for the schema.
export function Sound({
  tiles,
  anchors,
}: {
  tiles: TilesRendererImpl | null;
  anchors: SoundAnchors;
}) {
  const { camera, scene } = useThree();
  const config = useGame((s) => s.config)!;
  const runtimes = useRef<Runtime[]>([]);
  const listenerRef = useRef<AudioListener | null>(null);

  // Attach one listener to the camera; build the audio nodes for each cue.
  useEffect(() => {
    const listener = new AudioListener();
    listenerRef.current = listener;
    camera.add(listener);

    const cues = config.sounds ?? [];
    const rts: Runtime[] = cues.map((cue) => {
      const positional = !!(cue.at || cue.follow);
      const sound = positional ? new PositionalAudio(listener) : new Audio(listener);
      if (sound instanceof PositionalAudio) {
        sound.setRefDistance(cue.refDistance ?? 12);
        sound.setMaxDistance(cue.maxDistance ?? 120);
        sound.setDistanceModel("linear"); // maxDistance => truly silent past it
        scene.add(sound); // positional nodes must live in the scene graph
      }
      sound.setVolume(0);
      const rt: Runtime = { cue, positional, sound, loaded: false, gain: 0, fired: false };
      if (cue.pool) {
        // Random-clip player: load every clip; play one at random on a timer.
        rt.buffers = [];
        rt.timer = randRange(cue.every);
        cue.pool.forEach((src, i) =>
          loader.load(
            src,
            (buf) => {
              rt.buffers![i] = buf;
              rt.loaded = true; // ready once at least one clip is in
            },
            undefined,
            (e) => console.warn(`[sound] failed to load ${src}`, e),
          ),
        );
      } else {
        loader.load(
          cue.src!,
          (buf) => {
            sound.setBuffer(buf);
            sound.setLoop(cue.loop !== false && !cue.trigger);
            rt.loaded = true;
          },
          undefined,
          (e) => console.warn(`[sound] failed to load ${cue.src}`, e),
        );
      }
      return rt;
    });
    runtimes.current = rts;

    if (import.meta.env.DEV) {
      (window as any).__sounds = () =>
        rts.map((rt) => ({
          id: rt.cue.id,
          loaded: rt.loaded,
          playing: rt.sound.isPlaying,
          gain: +rt.gain.toFixed(3),
          positional: rt.positional,
        }));
      // Master listener gain — 0 while a minigame mutes the soundscape.
      (window as any).__masterVolume = () => listener.getMasterVolume();
    }

    // Browsers block audio until a user gesture — resume the context on the first.
    const resume = () => {
      if (listener.context.state === "suspended") listener.context.resume();
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      for (const rt of rts) {
        if (rt.sound.isPlaying) rt.sound.stop();
        if (rt.positional) scene.remove(rt.sound);
      }
      camera.remove(listener);
      runtimes.current = [];
      listenerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, scene, config]);

  // One-shot triggers fire on the phase edge into "reading" (a beacon arrival).
  const phase = useGame((s) => s.phase);
  useEffect(() => {
    if (phase !== "reading") {
      // reset the one-shots so they can fire again on the next arrival
      for (const rt of runtimes.current) if (rt.cue.trigger) rt.fired = false;
      return;
    }
    const stageIndex = useGame.getState().stageIndex;
    for (const rt of runtimes.current) {
      if (rt.cue.trigger !== "arrival" || rt.fired || !rt.loaded) continue;
      if (rt.cue.stages && !rt.cue.stages.includes(stageIndex)) continue;
      rt.sound.setVolume(rt.cue.volume ?? 0.6);
      rt.sound.play();
      rt.fired = true;
    }
  }, [phase]);

  useFrame((_, delta) => {
    const running = listenerRef.current?.context.state === "running";
    const st = useGame.getState();
    // Mute the whole game soundscape while a minigame is up — one master switch
    // silences ambient + positional + one-shots at once. A minigame that plays its
    // own audio (its own <audio>/AudioContext) is unaffected. Restored on resume.
    if (listenerRef.current)
      listenerRef.current.setMasterVolume(st.phase === "minigame" ? 0 : 1);
    const player = anchors.player.current?.position;

    for (const rt of runtimes.current) {
      const { cue, sound } = rt;
      if (!rt.loaded || cue.trigger === "arrival") continue; // arrival handled on phase edge

      // Resolve this cue's world anchor (if any) and place positional nodes.
      let hasAnchor = false;
      if (cue.follow === "player" && player) { _anchor.copy(player); hasAnchor = true; }
      // companion cue is silent while Chris is hidden (solo chapters, the goodbye)
      else if (cue.follow === "companion" && anchors.companion.current?.visible !== false) { _anchor.copy(anchors.companion.current!.position); hasAnchor = true; }
      else if (cue.follow === "car" && anchors.car.current) { _anchor.copy(anchors.car.current.position); hasAnchor = true; }
      else if (cue.follow === "beacon") { _anchor.copy(anchors.beacon.current); hasAnchor = true; }
      else if (cue.at && tiles) { latLngToWorld(tiles, cue.at, 0, _anchor); hasAnchor = true; }
      if (rt.positional && hasAnchor) sound.position.copy(_anchor);

      const inStage = !cue.stages || cue.stages.includes(st.stageIndex);
      const inRange =
        !cue.proximity ||
        (hasAnchor && !!player &&
          Math.hypot(player.x - _anchor.x, player.z - _anchor.z) <= cue.proximity);

      // Proximity one-shot (e.g. the kiss): fire once on entering range, re-arm on leaving.
      if (cue.trigger === "proximity") {
        if (running && inStage && inRange && hasAnchor) {
          if (!rt.fired) { sound.setVolume(cue.volume ?? 0.6); sound.play(); rt.fired = true; }
        } else if (rt.fired && (!inRange || !hasAnchor)) {
          rt.fired = false;
        }
        continue;
      }

      // Random-clip player (e.g. Chris's voice lines): count down, then play a
      // random clip from the pool while active (in-stage, in-range, anchored).
      if (cue.pool) {
        const active = running && inStage && inRange && hasAnchor && !!rt.buffers?.length;
        if (active && !sound.isPlaying) {
          rt.timer = (rt.timer ?? 0) - delta;
          if (rt.timer <= 0) {
            let i = Math.floor(Math.random() * rt.buffers!.length);
            if (rt.buffers!.length > 1 && i === rt.lastIdx) i = (i + 1) % rt.buffers!.length;
            if (rt.buffers![i]) {
              rt.lastIdx = i;
              sound.setBuffer(rt.buffers![i]);
              sound.setLoop(false);
              sound.setVolume(cue.volume ?? 0.6);
              sound.play();
            }
            rt.timer = randRange(cue.every);
          }
        }
        continue;
      }

      // Target gain: 0 unless this cue is active for the current stage and (if it
      // has a proximity gate) the player is within range of its anchor.
      let target = inStage && inRange ? (cue.volume ?? 0.6) : 0;

      // Start looping cues once the context is live; then ramp gain smoothly.
      if (running && !sound.isPlaying && (cue.loop !== false)) sound.play();
      const fade = cue.fade ?? 1.5;
      const step = ((cue.volume ?? 0.6) / fade) * delta || 1;
      if (rt.gain < target) rt.gain = Math.min(target, rt.gain + step);
      else if (rt.gain > target) rt.gain = Math.max(target, rt.gain - step);
      sound.setVolume(rt.gain);
    }
  });

  return null;
}
