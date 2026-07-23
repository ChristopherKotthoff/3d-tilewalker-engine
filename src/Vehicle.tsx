import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Box3, Group, Vector3 } from "three";
import type { Stage } from "./types";

useGLTF.preload("/plane.glb");

// Boardable travel models parked at the boarding beacon. The travel rule ("walk to
// the vehicle and board → teleport to the destination") is just the existing
// teleport action with the right model sitting on the orb.
//
// GLBs ship at wildly different native scales with non-uniform wrapper matrices,
// so we auto-fit each at runtime from its world Box3 instead of hand-tuning
// scale/lift. Per kind we only declare the target real-world length (longest
// horizontal axis, metres) and an optional lay-flat X rotation for models
// authored standing on end. Only `plane` ships here as an example — drop a GLB in
// public/ and add a row to board any vehicle. (`car` is the drivable Car.tsx and
// draws nothing here; `train`/`flixbus`/`bicycle` render no model unless you add
// them back.)
const MODELS: Record<string, { src: string; length: number; rotX?: number }> = {
  plane: { src: "/plane.glb", length: 27.2 },
};

export function Vehicle({
  stage,
  positionRef,
}: {
  stage: Stage;
  positionRef: React.MutableRefObject<Vector3>;
}) {
  const kind = stage.vehicle;
  if (!kind || !MODELS[kind]) return null; // car (drivable) / none → no boardable model here
  return <VehicleModel spec={MODELS[kind]} positionRef={positionRef} />;
}

function VehicleModel({
  spec,
  positionRef,
}: {
  spec: { src: string; length: number; rotX?: number };
  positionRef: React.MutableRefObject<Vector3>;
}) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(spec.src);
  // Fit once: apply the optional lay-flat rotation, measure the world box, then
  // offset the model so its horizontal centre + lowest point sit at the origin
  // (so the outer group can scale it, drop it on the beacon, and spin it cleanly).
  const { object, scale } = useMemo(() => {
    const obj = scene.clone(true);
    obj.rotation.x = spec.rotX ?? 0;
    obj.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    const scale = spec.length / Math.max(size.x, size.z, 0.001);
    obj.position.set(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2,
    );
    return { object: obj, scale };
  }, [scene, spec]);
  useFrame(() => {
    if (!group.current) return;
    const p = positionRef.current;
    group.current.position.set(p.x, p.y, p.z); // grounded: model's feet sit at beacon height
    group.current.rotation.y += 0.0015; // slow idle turn so it reads as "waiting to board"
  });
  return (
    <group ref={group} scale={scale}>
      <primitive object={object} />
    </group>
  );
}
