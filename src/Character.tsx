import { forwardRef, useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { Group, LoopOnce, LoopRepeat } from "three";
import { useGame } from "./store";

export type Gait = "idle" | "walk" | "run";

useGLTF.preload("/player.glb");

// Rotate the model so it faces -Z (the controller's heading-0 forward). Tuned
// empirically for player.glb; flip by Math.PI if it walks backwards.
const FACING = Math.PI;
const IDLE_BEFORE_SQUAT = 12; // s of standing still before the player drops for squats
const SQUAT_DURATION = 6; // s spent looping squats before getting back up

// Clip names inside player.glb (verified by parsing the GLB):
//   Walking, Running, Idle_02, Idle_03, Idle_4, All_Night_Dance,
//   air_squat, Agree_Gesture, Sit_and_Drink, Wave_One_Hand.
// (player.glb ships as a copy of chris.glb — swap in your own rigged glTF and
// remap these names to change the avatar; see docs/architecture.md.)
export const Character = forwardRef<
  Group,
  { gait: MutableRefObject<Gait>; forceClip?: MutableRefObject<string | null> }
>(
  function Character({ gait, forceClip }, ref) {
    const inner = useRef<Group>(null);
    const { scene, animations } = useGLTF("/player.glb");
    const { actions } = useAnimations(animations, inner);

    // Current logical animation state + time spent in it.
    const state = useRef<string>("Idle_02");
    const stateTime = useRef(0);

    // Cross-fade helper. loop=false plays a one-shot that clamps on its last frame.
    const fadeTo = (name: string, loop = true) => {
      if (state.current === name) return;
      const next = actions[name];
      const prev = actions[state.current];
      if (next) {
        next.reset();
        next.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
        next.clampWhenFinished = !loop;
        next.fadeIn(0.25).play();
      }
      if (prev && prev !== next) prev.fadeOut(0.25);
      state.current = name;
      stateTime.current = 0;
    };

    // Kick off idle on mount + let the character cast shadows.
    useEffect(() => {
      scene.traverse((o: any) => {
        if (o.isMesh) o.castShadow = true;
      });
      const idle = actions["Idle_02"];
      idle?.reset().play();
      state.current = "Idle_02";
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actions, scene]);

    useFrame((_, delta) => {
      stateTime.current += delta;
      const phase = useGame.getState().phase;
      const g = gait.current;
      if (import.meta.env.DEV)
        (window as any).__animState = () =>
          JSON.stringify({ state: state.current, t: +stateTime.current.toFixed(1), gait: g, phase });

      // 1) Celebrating (a beacon modal / the ending is up) — the player dances.
      if (phase === "reading" || phase === "ended") {
        fadeTo("All_Night_Dance", true);
        return;
      }

      // 2) Moving always wins over the idle easter-egg.
      if (g === "run") return void fadeTo("Running", true);
      if (g === "walk") return void fadeTo("Walking", true);

      // 2b) A story stage may pin a clip on the companion (sit, dance, wave...).
      // The player shares the companion's rig (player.glb is a copy of chris.glb),
      // so mirror any pinned clip it actually has.
      const forced = forceClip?.current ?? null;
      if (forced && actions[forced]) return void fadeTo(forced, true);

      // 3) Standing still: idle, then the air-squat easter-egg after a while.
      const s = state.current;
      switch (s) {
        case "Idle_02":
        case "Idle_03":
          if (stateTime.current > IDLE_BEFORE_SQUAT) fadeTo("air_squat", true);
          break;
        case "air_squat":
          if (stateTime.current > SQUAT_DURATION) fadeTo("Idle_03", true);
          break;
        default:
          // Coming from Walking / Running / All_Night_Dance — settle into idle.
          fadeTo("Idle_02", true);
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
