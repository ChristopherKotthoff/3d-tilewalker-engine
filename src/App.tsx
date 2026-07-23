import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping, PCFSoftShadowMap } from "three";
import { useGame } from "./store";
import { World } from "./World";
import { UI } from "./UI";
import type { GameConfig, LatLng } from "./types";

// Parse a Google Maps /maps/dir/lat,lng/lat,lng/... URL path into start+target.
function parseNavRoute(pathname: string): { start: LatLng; target: LatLng } | null {
  const m = pathname.match(/^\/maps\/dir\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  const parse = (s: string): LatLng | null => {
    const parts = s.replace(/\+/g, "").split(",").map(Number);
    return parts.length >= 2 && !parts.slice(0, 2).some(isNaN)
      ? { lat: parts[0], lng: parts[1] }
      : null;
  };
  const start = parse(m[1]);
  const target = parse(m[2]);
  return start && target ? { start, target } : null;
}

export function App() {
  const config = useGame((s) => s.config);
  const phase = useGame((s) => s.phase);

  // Load the runtime game definition once at startup (hot-reloads via vite plugin).
  useEffect(() => {
    fetch("/game.json")
      .then((r) => {
        if (!r.ok) throw new Error(`game.json HTTP ${r.status}`);
        return r.json();
      })
      .then((cfg: GameConfig) => {
        useGame.getState().setConfig(cfg);
        useGame.getState().setPhase("intro");
        const nav = parseNavRoute(window.location.pathname);
        if (nav) useGame.getState().setNavRoute(nav.start, nav.target);
      })
      .catch((e) => {
        console.error("Failed to load game.json:", e);
        alert("Could not load /game.json — see console.");
      });
  }, []);

  const hasKey = !!import.meta.env.VITE_GOOGLE_API_KEY;

  return (
    <>
      <Canvas
        camera={{ fov: 60, near: 1, far: 1_000_000, position: [0, 6, 10] }}
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        shadows={{ type: PCFSoftShadowMap }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        {/* Only mount the tiles world once config is loaded AND we've left intro,
            so we don't fire a Google root request until the player begins. */}
        {config && phase !== "intro" && phase !== "loading" && <World />}
      </Canvas>
      <UI />
      {!hasKey && (
        <div style={warn}>
          ⚠ VITE_GOOGLE_API_KEY is not set — the city won't stream. Check your .env.
        </div>
      )}
    </>
  );
}

const warn: React.CSSProperties = {
  position: "absolute", top: 8, right: 8, zIndex: 50,
  background: "rgba(180,40,40,0.9)", color: "#fff", padding: "8px 12px",
  borderRadius: 8, fontFamily: "system-ui", fontSize: 13, maxWidth: 320,
};
