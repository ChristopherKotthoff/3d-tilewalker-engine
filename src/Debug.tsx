import { useEffect, useState } from "react";
import { useGame } from "./store";

// Shape produced by World (exposed on window in DEV) — the live scene state.
type Snapshot = {
  player: { lat: number; lng: number; x: number; z: number; y: number };
  heading: number;
  camera: { x: number; y: number; z: number; yaw: number; pitch: number; dist: number };
  stageIndex: number;
  phase: string;
  inCar: boolean;
  heightOffset: number;
};

// Toggle with P. Lets you tag a spot with a message and dump the full scene
// state (character + look + camera coords) to the console in copy-ready form,
// and teleport to any lat/lng on Earth. DEV-only; mounted from UI.
export function Debug() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const heightOffset = useGame((s) => s.heightOffset);
  const setHeightOffset = useGame((s) => s.setHeightOffset);
  const config = useGame((s) => s.config);
  const stageIndex = useGame((s) => s.stageIndex);
  const jump = useGame((s) => s.devJumpToStage);
  const setDebugOpen = useGame((s) => s.setDebugOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore P while typing in the debug fields.
      if (e.code === "KeyP" && !(e.target as HTMLElement)?.closest?.("[data-debug]")) {
        e.preventDefault();
        setOpen((v) => !v);
        // release pointer-lock so the modal is usable
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mirror open state into the store so the world can make the orb inert (no
  // auto-advance/teleport) and not steal pointer-lock while debugging.
  useEffect(() => {
    setDebugOpen(open);
    return () => setDebugOpen(false);
  }, [open, setDebugOpen]);

  if (!open) return null;

  const snap = (): Snapshot | null => (window as any).__debugSnapshot?.() ?? null;

  const remember = () => {
    const s = snap();
    if (!s) return console.warn("[remember] no snapshot yet");
    const f = (n: number) => n.toFixed(3);
    const f6 = (n: number) => n.toFixed(6);
    console.log(
      `%c📍 REMEMBER%c ${msg || "(no message)"}\n` +
        `  location : { "lat": ${f6(s.player.lat)}, "lng": ${f6(s.player.lng)} }\n` +
        `  world    : x=${f(s.player.x)} y=${f(s.player.y)} z=${f(s.player.z)}\n` +
        `  heading  : ${f(s.heading)} rad\n` +
        `  camera   : yaw=${f(s.camera.yaw)} pitch=${f(s.camera.pitch)} dist=${f(s.camera.dist)}\n` +
        `  cam world: x=${f(s.camera.x)} y=${f(s.camera.y)} z=${f(s.camera.z)}\n` +
        `  height   : ${f(s.heightOffset)} m  (settings.heightOffset)\n` +
        `  stage    : ${s.stageIndex}   phase: ${s.phase}   inCar: ${s.inCar}`,
      "color:#9fd0ff;font-weight:700",
      "color:#eef3ff",
    );
  };

  const teleport = () => {
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    if (Number.isNaN(la) || Number.isNaN(ln)) return console.warn("[teleport] bad coords");
    useGame.getState().devTeleport({ lat: la, lng: ln });
  };

  const preset = (la: number, ln: number) => () => {
    setLat(String(la));
    setLng(String(ln));
  };

  return (
    <div data-debug style={D.panel}>
      <div style={D.head}>
        <b style={{ color: "#9fd0ff" }}>Debug</b>
        <span style={{ opacity: 0.6 }}>press P to close</span>
      </div>

      <label style={D.label}>Message</label>
      <input
        style={D.input}
        value={msg}
        placeholder="note for this spot…"
        onChange={(e) => setMsg(e.target.value)}
      />
      <button style={D.btn} onClick={remember}>REMEMBER → console</button>

      <div style={D.rule} />

      <label style={D.label}>
        Chapter jump · stage {stageIndex + 1}/{config?.quest.length ?? 0}
      </label>
      <select
        style={D.input}
        value={stageIndex}
        onChange={(e) => jump(Number(e.target.value))}
      >
        {config?.quest.map((q, i) => (
          <option key={q.id} value={i}>
            {i + 1}. {q.chapter ?? q.clueTitle}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={D.chip} onClick={() => jump(stageIndex - 1)}>◀ back</button>
        <button style={D.chip} onClick={() => jump(stageIndex)}>↻ replay</button>
        <button style={D.chip} onClick={() => jump(stageIndex + 1)}>next ▶</button>
      </div>
      <button style={D.chip} onClick={() => useGame.getState().summonCar()}>🚗 spawn car</button>

      <div style={D.rule} />

      <label style={D.label}>Height offset · {heightOffset.toFixed(2)} m</label>
      <input
        type="range" min={-3} max={5} step={0.05} value={heightOffset}
        onChange={(e) => setHeightOffset(parseFloat(e.target.value))}
      />
      <span style={{ fontSize: 11, opacity: 0.6 }}>
        lifts the player out of the floor — paste into settings.heightOffset
      </span>

      <div style={D.rule} />

      <label style={D.label}>Teleport to lat / lng</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={D.input} value={lat} placeholder="lat" onChange={(e) => setLat(e.target.value)} />
        <input style={D.input} value={lng} placeholder="lng" onChange={(e) => setLng(e.target.value)} />
      </div>
      <div style={D.presets}>
        {(
          [
            ["Zürich HB", 47.3779, 8.5403],
            ["Zürich", 47.3769, 8.5417],
            ["Manhattan", 40.7580, -73.9855],
            ["Eiffel", 48.8584, 2.2945],
            ["Sydney", -33.8568, 151.2153],
          ] as const
        ).map(([name, la, ln]) => (
          <button key={name} style={D.chip} onClick={preset(la, ln)}>{name}</button>
        ))}
      </div>
      <button style={{ ...D.btn, background: "#c77dff" }} onClick={teleport}>WARP</button>
    </div>
  );
}

const D: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute", top: 16, right: 16, width: 300, zIndex: 60,
    background: "rgba(12,16,28,0.94)", color: "#eef3ff", borderRadius: 12,
    border: "1px solid rgba(120,160,255,0.3)", padding: 16,
    fontFamily: "system-ui, sans-serif", fontSize: 13,
    display: "flex", flexDirection: "column", gap: 8,
    pointerEvents: "auto", backdropFilter: "blur(6px)",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 },
  input: {
    width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
    border: "1px solid rgba(120,160,255,0.3)", background: "rgba(0,0,0,0.35)",
    color: "#eef3ff", fontSize: 13,
  },
  btn: {
    cursor: "pointer", border: "none", borderRadius: 8, padding: "9px 12px",
    fontSize: 13, fontWeight: 600, background: "#4c8dff", color: "#fff",
  },
  chip: {
    cursor: "pointer", border: "1px solid rgba(120,160,255,0.3)", borderRadius: 14,
    padding: "4px 10px", fontSize: 12, background: "rgba(0,0,0,0.3)", color: "#cfe0ff",
  },
  presets: { display: "flex", flexWrap: "wrap", gap: 6 },
  rule: { height: 1, background: "rgba(120,160,255,0.2)", margin: "4px 0" },
};
