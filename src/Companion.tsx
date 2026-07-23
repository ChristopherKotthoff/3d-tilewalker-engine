import { forwardRef, useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { Group, LoopOnce, LoopRepeat } from "three";
import type { Gait } from "./Character";

useGLTF.preload("/chris.glb");

// Same rig/orientation as the player model (both are chris.glb), faces -Z.
const FACING = Math.PI;

// chris.glb clips (verified by parsing the GLB, with durations):
//   Walking 1.0s, Running 0.6s, Idle_02 2.3s, Idle_03 5.3s, Idle_4 14.0s,
//   Agree_Gesture 13.0s, All_Night_Dance 8.2s, air_squat 1.9s.
// Gait clips loop; idle clips are played one-shot then a new one is picked, so
// Chris shuffles through calm idles with the occasional dance / squat / gesture
// while waiting for the player — a living companion, not a T-pose.
const WALK = "Walking";
const RUN = "Running";
// Idle pool with pick weights (calm idles common; the showy ones rare).
const IDLE_POOL: [name: string, weight: number][] = [
  ["Idle_02", 5],
  ["Idle_03", 4],
  ["Idle_4", 3],
  ["All_Night_Dance", 2],
  ["air_squat", 1],
  ["Agree_Gesture", 1],
];
const IDLE_TOTAL = IDLE_POOL.reduce((s, [, w]) => s + w, 0);

// Weighted-random next idle, never repeating the current one back-to-back.
function pickIdle(exclude: string): string {
  let r = Math.random() * IDLE_TOTAL;
  for (const [name, w] of IDLE_POOL) {
    r -= w;
    if (r <= 0 && name !== exclude) return name;
  }
  return IDLE_POOL.find(([n]) => n !== exclude)?.[0] ?? IDLE_POOL[0][0];
}

// Chris: a companion the world steers via `ref` (position/rotation set each frame
// by World's follower logic). He only owns his own animation here.
// `forceClip` (a story stage may pin one — dance in the club, wave goodbye, sit to
// drink) overrides the random idle pool while he's standing still.
export const Companion = forwardRef<
  Group,
  { gait: MutableRefObject<Gait>; forceClip?: MutableRefObject<string | null> }
>(
  function Companion({ gait, forceClip }, ref) {
    const inner = useRef<Group>(null);
    const { scene, animations } = useGLTF("/chris.glb");
    const { actions } = useAnimations(animations, inner);

    // Current logical clip. `moving` tracks whether we're in a gait or idling.
    const clip = useRef<string>(IDLE_POOL[0][0]);
    const moving = useRef(false);

    // Cross-fade helper. loop=false plays a one-shot that clamps on its last frame.
    const fadeTo = (name: string, loop: boolean) => {
      if (clip.current === name) return;
      const next = actions[name];
      const prev = actions[clip.current];
      if (next) {
        next.reset();
        next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
        next.clampWhenFinished = !loop;
        next.fadeIn(0.3).play();
      }
      if (prev && prev !== next) prev.fadeOut(0.3);
      clip.current = name;
    };

    const idleDone = () => {
      const a = actions[clip.current];
      return !!a && a.time >= a.getClip().duration - 0.1;
    };

    useEffect(() => {
      scene.traverse((o: any) => {
        if (o.isMesh) o.castShadow = true;
      });
      fadeTo(IDLE_POOL[0][0], false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actions, scene]);

    useFrame(() => {
      const g = gait.current;
      if (import.meta.env.DEV) (window as any).__chrisClip = () => clip.current;
      if (g === "run") {
        moving.current = true;
        return void fadeTo(RUN, true);
      }
      if (g === "walk") {
        moving.current = true;
        return void fadeTo(WALK, true);
      }
      // Idle. A story stage can pin a specific clip (dance / wave / sit); loop it.
      const forced = forceClip?.current ?? null;
      if (forced) {
        moving.current = false;
        fadeTo(forced, true);
        return;
      }
      // Otherwise: coming to a stop, or a one-shot idle finished — pick the next.
      if (moving.current || idleDone()) {
        moving.current = false;
        fadeTo(pickIdle(clip.current), false);
      }
    });

    return (
      <group ref={ref}>
        <group ref={inner} rotation={[0, FACING, 0]}>
          <primitive object={scene} />
        </group>
      </group>
    );
  },
);
