import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, Group, Mesh, Vector3 } from "three";

interface GlowProps {
  /** Live world position (mutated each frame by the world's raycast). */
  positionRef: React.MutableRefObject<Vector3>;
  color: string;
  teleport?: boolean;
}

// A tall semi-transparent additive cylinder + inner point light. Teleport glows
// spin and pulse harder so players learn "this one warps me".
export function Glow({ positionRef, color, teleport = false }: GlowProps) {
  const group = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const c = new Color(color);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.position.copy(positionRef.current);
      if (teleport) group.current.rotation.y = t * 1.5;
    }
    if (beam.current) {
      const pulse = 1 + Math.sin(t * (teleport ? 4 : 2)) * 0.12;
      beam.current.scale.set(pulse, 1, pulse);
    }
  });

  const height = teleport ? 40 : 30;
  const radius = teleport ? 3.5 : 2.5;

  return (
    <group ref={group}>
      <mesh ref={beam} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius, radius, height, 24, 1, true]} />
        <meshBasicMaterial
          color={c}
          transparent
          opacity={teleport ? 0.5 : 0.35}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* inner brighter core */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius * 0.4, radius * 0.4, height, 16, 1, true]} />
        <meshBasicMaterial
          color={c}
          transparent
          opacity={0.6}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight color={c} intensity={teleport ? 120 : 60} distance={40} position={[0, 4, 0]} />
    </group>
  );
}
