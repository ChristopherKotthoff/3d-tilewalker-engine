import { forwardRef, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Group, Vector3 } from "three";

useGLTF.preload("/car.glb");

// The drivable car. The world steers it via `ref` (position/rotation set each
// frame); no physics — it just carries the player. Its GLB is authored facing -Z
// (length along Z), matching the character's FACING, and its origin sits below
// the wheels, so we auto-fit from the Box3: scale to a real car length and lift
// so the wheels rest on the ground.
const CAR_LENGTH = 5.06; // metres, longest axis

export const Car = forwardRef<Group, {}>(function Car(_props, ref) {
  const { scene } = useGLTF("/car.glb");
  const { object, scale } = useMemo(() => {
    const obj = scene.clone(true);
    obj.rotation.y = Math.PI; // GLB faces +Z; flip to -Z to match FACING / drive direction
    obj.updateWorldMatrix(true, true);
    obj.traverse((o: any) => {
      if (o.isMesh) o.castShadow = true;
    });
    const box = new Box3().setFromObject(obj);
    const size = box.getSize(new Vector3());
    const scale = CAR_LENGTH / Math.max(size.x, size.z, 0.001);
    obj.position.set(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2,
    );
    return { object: obj, scale };
  }, [scene]);
  return (
    <group ref={ref}>
      <group scale={scale}>
        <primitive object={object} />
      </group>
    </group>
  );
});
