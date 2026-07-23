import { useEffect, useRef, useState } from "react";
import { useGame, radar } from "./store";
import type { LatLng } from "./types";

// GTA-style radar: the map orients camera-up (the world rotates under the
// camera's view direction) and the player arrow turns to show which way the player
// faces relative to it. The dial is filled with real Google 2D satellite tiles
// (Map Tiles API session, same key as the 3D city). The target blip shows the
// next beacon; beyond RANGE metres it becomes a pulsing glow on the rim at its
// bearing. Draws in its own rAF loop off the shared `radar` object — no React
// re-render per frame (the golden rule: world writes, UI reads).
const SIZE = 150; // px diameter
// ± buttons step through these; index 2 is the default. Each range halving
// bumps the mercator zoom so the imagery stays ~equally sharp.
const RANGES = [30, 60, 120, 240, 480]; // metres shown edge-to-edge from centre
const ZOOMS = [19, 18, 17, 16, 15];
const KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

// One 2D-tiles session per page load (the Map Tiles API requires it). Google
// attribution is already on screen via the 3D tiles' attribution line.
let session: string | null = null;
let sessionReq: Promise<void> | null = null;
function ensureSession() {
  sessionReq ??= fetch(`https://tile.googleapis.com/v1/createSession?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
  })
    .then((r) => r.json())
    .then((j) => { session = j.session; })
    .catch(() => { sessionReq = null; }); // retry on next mount
  return sessionReq;
}

// ponytail: insertion-order eviction, real LRU if tile churn ever matters
const tileCache = new Map<string, HTMLImageElement>();
function tile(zoom: number, x: number, y: number): HTMLImageElement | null {
  const n = 1 << zoom;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n || !session) return null;
  const k = `${zoom}/${x}/${y}`;
  let img = tileCache.get(k);
  if (!img) {
    if (tileCache.size > 128) tileCache.delete(tileCache.keys().next().value!);
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}?session=${session}&key=${KEY}`;
    tileCache.set(k, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// lat/lng -> normalized [0,1] web-mercator (multiply by 256<<zoom for tile px)
function toMerc(lat: number, lng: number) {
  const r = (lat * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2,
  };
}

// standard encoded-polyline decoder (Routes API returns one)
function decodePolyline(s: string) {
  const pts: { x: number; y: number }[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    pts.push(toMerc(lat / 1e5, lng / 1e5));
  }
  return pts;
}

// Walking route overlay: fetched ONCE per stage (from wherever the player is
// when the stage becomes active, to its target), stored as normalized mercator.
// No retry on failure by design — a missing route just means no overlay.
let route: { x: number; y: number }[] | null = null;
let routeKey = "";
function ensureRoute(stageIndex: number, target: LatLng | undefined) {
  const key = target ? `${stageIndex}:${target.lat},${target.lng}` : "";
  if (routeKey === key || !target || !(radar.lat || radar.lng)) return;
  routeKey = key;
  route = null;
  fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: radar.lat, longitude: radar.lng } } },
      destination: { location: { latLng: { latitude: target.lat, longitude: target.lng } } },
      travelMode: "WALK",
    }),
  })
    .then((r) => r.json())
    .then((j) => {
      const enc = j.routes?.[0]?.polyline?.encodedPolyline;
      if (enc) route = decodePolyline(enc);
    })
    .catch(() => {});
}

export function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [level, setLevel] = useState(2); // index into RANGES/ZOOMS
  const phase = useGame((s) => s.phase);
  const stageIndex = useGame((s) => s.stageIndex);
  const config = useGame((s) => s.config);
  const stage = config?.quest[stageIndex];
  const color =
    stage?.glowColor ?? (stage?.glowStyle === "teleport" ? "#c77dff" : "#5fd0ff");

  useEffect(() => {
    if (phase !== "playing" && phase !== "reading") return;
    const RANGE = RANGES[level];
    const ZOOM = ZOOMS[level];
    ensureSession();
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = SIZE * dpr;
    el.height = SIZE * dpr;
    const ctx = el.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const R = SIZE / 2;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, SIZE, SIZE);

      // once-per-stage route fetch; read live state, not the render closure (§8.4)
      const st = useGame.getState();
      const routeTarget = (st.navMode && st.navTarget) ? st.navTarget : st.config?.quest[st.stageIndex]?.target;
      ensureRoute(st.stageIndex, routeTarget);

      // dial, clipped to a circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(18,22,30,0.72)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // satellite underlay. World frame is +X west / +Z north (Reorientation
      // ENU); mercator pixels are +x east / +y south — so mapping mercator px
      // into world metres is a uniform scale by -mpp on both axes. On top of
      // that, rotate(camYaw) makes the map camera-up like the blip math below.
      const scale = R / RANGE;
      if (session && (radar.lat || radar.lng)) {
        const mpp =
          (156543.03392 * Math.cos((radar.lat * Math.PI) / 180)) / (1 << ZOOM);
        const world = 256 * (1 << ZOOM);
        const ppx = ((radar.lng + 180) / 360) * world;
        const latR = (radar.lat * Math.PI) / 180;
        const ppy =
          ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) *
          world;
        ctx.save();
        ctx.translate(R, R);
        ctx.rotate(radar.camYaw);
        ctx.scale(-scale * mpp, -scale * mpp); // mercator px -> canvas
        const r = RANGE / mpp; // visible radius in mercator px
        for (let tx = Math.floor((ppx - r) / 256); tx * 256 <= ppx + r; tx++)
          for (let ty = Math.floor((ppy - r) / 256); ty * 256 <= ppy + r; ty++) {
            const img = tile(ZOOM, tx, ty);
            // 256.5: hairline seam cover under rotation
            if (img) ctx.drawImage(img, tx * 256 - ppx, ty * 256 - ppy, 256.5, 256.5);
          }
        // walking route (same transform as the tiles, so it aligns exactly)
        if (route && route.length > 1) {
          ctx.strokeStyle = "rgba(120,200,255,0.9)";
          ctx.lineWidth = 3 / (scale * mpp); // ~3 canvas px
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          for (let i = 0; i < route.length; i++) {
            const x = route[i].x * world - ppx;
            const y = route[i].y * world - ppy;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
        // tint so the blips stay readable over bright imagery
        ctx.fillStyle = "rgba(10,14,22,0.28)";
        ctx.fillRect(0, 0, SIZE, SIZE);
      }

      // target bearing in camera-frame (camera forward = up on screen)
      const dx = radar.tx - radar.px;
      const dz = radar.tz - radar.pz;
      const h = radar.camYaw;
      const fwd = dx * -Math.sin(h) + dz * -Math.cos(h);
      const right = dx * Math.cos(h) + dz * -Math.sin(h);
      const bx = right * scale;
      const by = -fwd * scale;
      const dist = Math.hypot(dx, dz);
      if (Math.hypot(bx, by) > R - 8) {
        // out of range: pulsing glow on the rim at the target's bearing
        const a = Math.atan2(by, bx);
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 250);
        ctx.strokeStyle = color;
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(R, R, R - 4, a - 0.45, a + 0.45);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(R + bx, R + by, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.restore();

      // player arrow: turns with the player's heading relative to the camera-up map
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(radar.camYaw - radar.heading);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // rim + distance readout
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(R, R, R - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(dist)} m`, R, SIZE - 6);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [phase, color, level]);

  if (phase !== "playing" && phase !== "reading") return null;
  const zoomBtn = (label: string, delta: number, disabled: boolean) => (
    <button
      onClick={() => setLevel((l) => l + delta)}
      disabled={disabled}
      style={{
        width: 22, height: 22, borderRadius: "50%", border: "none",
        background: "rgba(18,22,30,0.8)", color: "#fff",
        font: "700 14px system-ui, sans-serif", lineHeight: "22px",
        padding: 0, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1, pointerEvents: "auto",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ position: "absolute", bottom: 18, left: 18, zIndex: 10, pointerEvents: "none" }}>
      <canvas
        ref={canvas}
        width={SIZE}
        height={SIZE}
        style={{
          display: "block",
          width: SIZE, height: SIZE, borderRadius: "50%",
          filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
        }}
      />
      <div style={{ position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
                    display: "flex", flexDirection: "column", gap: 4 }}>
        {zoomBtn("+", -1, level === 0)}
        {zoomBtn("−", 1, level === RANGES.length - 1)}
      </div>
    </div>
  );
}
