import { useEffect, useRef, useState } from "react";
import type { Minigame, MinigameProps } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// PUNTING THE RIVER — side-view, animated (all simple SVG shapes).
//
// The scene scrolls: spires and trees drift by on the far bank while the player
// poles the punt down the river. The pole swings on a fixed cycle; once per
// cycle its tip PLANTS in the water (the bright window). Press Space THEN to push
// off — the punt surges forward and the stroke counts. Press at the wrong moment
// and the punter overbalances, tips into the river (💦), and you start the reach
// again from the near bank (progress resets). Land enough clean strokes to reach
// the far bank.
//
// The "fall in on a mistimed press → start again" loop is the game the brief asked
// for. Skip (in the window header) is the only true soft-fail — a keepsake, not a
// difficulty curve.
// ─────────────────────────────────────────────────────────────────────────────

const STROKES_TO_WIN = 6;   // clean strokes to reach the far bank
const CYCLE = 1.6;          // seconds per pole swing
const HIT_LO = 0.44;        // timing window (fraction of cycle) the tip is planted
const HIT_HI = 0.60;
const PLANT = 0.5;          // phase where the pole reaches deepest (peak of the swing)
const RESPAWN = 1.1;        // seconds face-down in the water after a fall
const DRIFT = 10;           // idle scroll px/s (she's always gently drifting)
const SURGE = 130;          // px/s of forward push added per clean stroke
const SURGE_DECAY = 1.9;    // surge dies away between strokes
const WRAP = 520;           // scenery repeat width (svg units)
const MAX_DT = 0.05;        // clamp big rAF gaps (tab-away) so nothing jumps

// Far-bank set-dressing, laid out once and wrapped as the river scrolls. b=building,
// s=spire (chapel), t=tree, w=willow. x is along the repeat; h is height above bank.
const SCENERY: { x: number; k: "b" | "s" | "t" | "w"; w: number; h: number; c: string }[] = [
  { x: 20, k: "b", w: 46, h: 40, c: "#c9bfa6" },
  { x: 90, k: "t", w: 30, h: 34, c: "#5c8a4e" },
  { x: 150, k: "s", w: 34, h: 72, c: "#d8cfb4" },
  { x: 215, k: "b", w: 54, h: 34, c: "#bdb298" },
  { x: 300, k: "w", w: 40, h: 30, c: "#6ea05a" },
  { x: 360, k: "b", w: 42, h: 46, c: "#cabf9f" },
  { x: 430, k: "t", w: 26, h: 28, c: "#4f7d43" },
  { x: 480, k: "b", w: 48, h: 38, c: "#c3b89c" },
];

interface View {
  phase: number;   // 0..1 pole cycle
  progress: number; // clean strokes
  scroll: number;  // scenery offset
  boatDx: number;  // px the punt leans forward from surge
  bob: number;     // vertical bob
  fallen: boolean; // face-down in the foam
  planted: boolean; // pole in the water right now (the "press!" cue)
  won: boolean;
  flash: "hit" | "miss" | null;
}

function PuntingGame({ params, onWin }: MinigameProps) {
  const strokesToWin = numParam(params.strokes, STROKES_TO_WIN);

  const [view, setView] = useState<View>({
    phase: 0, progress: 0, scroll: 0, boatDx: 0, bob: 0,
    fallen: false, planted: false, won: false, flash: null,
  });

  // Simulation lives in refs; setView only publishes what renders.
  const phase = useRef(0);
  const progress = useRef(0);
  const scroll = useRef(0);
  const surge = useRef(0);
  const fallT = useRef(0);
  const clock = useRef(0);
  const won = useRef(false);
  const flash = useRef<{ kind: "hit" | "miss"; until: number } | null>(null);
  const raf = useRef(0);

  // Animation loop — accumulate rAF deltas (no Date.now).
  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;
      clock.current += dt;

      if (fallT.current > 0) {
        // In the water: hold still until she climbs back on, then restart the reach.
        fallT.current -= dt;
        surge.current = 0;
        if (fallT.current <= 0) { phase.current = 0; scroll.current = 0; }
      } else if (!won.current) {
        phase.current = (phase.current + dt / CYCLE) % 1;
        surge.current *= Math.exp(-SURGE_DECAY * dt);
        scroll.current += (DRIFT + surge.current) * dt;
      }

      const f = flash.current && flash.current.until > clock.current ? flash.current.kind : null;
      setView({
        phase: phase.current,
        progress: progress.current,
        scroll: scroll.current,
        boatDx: Math.min(14, surge.current * 0.06),
        bob: Math.sin(clock.current * 2.4) * 2.5,
        fallen: fallT.current > 0,
        planted: !won.current && fallT.current <= 0 &&
          phase.current >= HIT_LO && phase.current <= HIT_HI,
        won: won.current,
        flash: f,
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // Space / Enter / click on the scene = pole.
  useEffect(() => {
    const stroke = () => {
      if (won.current || fallT.current > 0) return;
      const good = phase.current >= HIT_LO && phase.current <= HIT_HI;
      flash.current = { kind: good ? "hit" : "miss", until: clock.current + 0.4 };
      if (good) {
        surge.current += SURGE;
        progress.current += 1;
        if (progress.current >= strokesToWin) {
          won.current = true;
          setTimeout(onWin, 900);
        }
      } else {
        // Mistimed → into the river, start the reach again.
        fallT.current = RESPAWN;
        progress.current = 0;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); stroke(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [strokesToWin, onWin]);

  const pct = Math.round((view.progress / strokesToWin) * 100);
  // Pole swing: triangle peaking at PLANT. -1 (raised, reaching forward) → +1 (planted).
  const t = view.phase < PLANT ? view.phase / PLANT : (1 - view.phase) / (1 - PLANT);
  const poleDeg = -60 + 100 * t; // rotate the pole about the punter's hands

  return (
    <div style={{ userSelect: "none" }}>
      <p style={{ marginTop: 0, fontSize: 16, lineHeight: 1.5 }}>
        Press <b>Space</b> the moment the pole <b>plants in the water</b> (the bank
        glows and it reads <i>NOW</i>) to push off. Time it wrong and you tip
        into the river — you start the reach again from the near bank.
      </p>

      <div
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))}
        style={{ cursor: "pointer", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(40,70,60,0.5)" }}
      >
        <svg viewBox="0 0 400 200" style={{ display: "block", width: "100%" }}>
          <defs>
            <linearGradient id="cw-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#bfe0ea" />
              <stop offset="1" stopColor="#e6f0e0" />
            </linearGradient>
            <linearGradient id="cw-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8fb7a8" />
              <stop offset="1" stopColor="#4d7d74" />
            </linearGradient>
          </defs>

          {/* sky + far bank */}
          <rect x="0" y="0" width="400" height="92" fill="url(#cw-sky)" />
          <rect x="0" y="80" width="400" height="14" fill="#6ea05a" />

          {/* scrolling scenery on the far bank */}
          {SCENERY.map((o, i) => {
            const x = wrap(o.x - view.scroll, WRAP) - 60; // enter from right, exit left
            const base = 84;
            if (o.k === "b")
              return <rect key={i} x={x} y={base - o.h} width={o.w} height={o.h} fill={o.c}
                stroke="rgba(80,70,50,0.35)" rx="1" />;
            if (o.k === "s")
              return (
                <g key={i}>
                  <rect x={x} y={base - o.h * 0.55} width={o.w} height={o.h * 0.55} fill={o.c}
                    stroke="rgba(80,70,50,0.35)" />
                  <polygon points={`${x},${base - o.h * 0.55} ${x + o.w / 2},${base - o.h} ${x + o.w},${base - o.h * 0.55}`}
                    fill="#b9ad8c" />
                </g>
              );
            // tree / willow
            return (
              <g key={i}>
                <rect x={x + o.w / 2 - 2} y={base - o.h * 0.4} width="4" height={o.h * 0.4} fill="#6b4a2b" />
                <circle cx={x + o.w / 2} cy={base - o.h * 0.55} r={o.w / 2} fill={o.c} />
              </g>
            );
          })}

          {/* water */}
          <rect x="0" y="92" width="400" height="108" fill="url(#cw-water)" />
          {[110, 132, 156, 180].map((y, i) => (
            <path key={y}
              d={ripple(y, wrap(view.scroll * (0.5 + i * 0.15), 60))}
              stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" />
          ))}

          {/* the plant cue: a glowing patch of water behind the stern when it's time */}
          {view.planted && !view.fallen && (
            <>
              <ellipse cx="252" cy="150" rx="26" ry="7" fill="rgba(255,244,190,0.55)" />
              <text x="252" y="128" textAnchor="middle" fontSize="15" fontWeight="700"
                fill="#f7f0d0" style={{ letterSpacing: 2 }}>NOW</text>
            </>
          )}

          {/* the punt + punter, bobbing near the centre */}
          <g transform={`translate(${200 + view.boatDx} ${140 + view.bob})`}>
            {/* hull */}
            <polygon points="-64,10 64,10 74,2 -74,2" fill="#7a5230" stroke="#4f351d" strokeWidth="1.5" />
            <rect x="-70" y="-1" width="140" height="4" fill="#93693f" />

            {/* seated passenger, riding at the stern (brownish skin) */}
            <g transform="translate(-42 0)">
              {/* bent legs resting along the hull */}
              <line x1="0" y1="0" x2="16" y2="-2" stroke="#2f4a63" strokeWidth="5" strokeLinecap="round" />
              {/* torso reclining back */}
              <rect x="-6" y="-24" width="11" height="20" rx="4" fill="#d98a3c" transform="rotate(-14 0 -4)" />
              {/* head */}
              <circle cx="-9" cy="-27" r="6" fill="#a5673f" />
              {/* hair */}
              <path d="M-15 -27 q0 -8 6 -8 q6 0 6 8 q-6 -4 -12 0 z" fill="#3a281c" />
              {/* arm draped over the side */}
              <line x1="-3" y1="-14" x2="6" y2="-2" stroke="#a5673f" strokeWidth="3" strokeLinecap="round" />
            </g>

            {/* the punter — falls in on a mistimed stroke */}
            {view.fallen ? (
              <g transform="translate(70 18)">
                <text x="0" y="-2" textAnchor="middle" fontSize="26">💦</text>
                <circle cx="-2" cy="4" r="5" fill="#e8c9a0" />
              </g>
            ) : (
              <g>
                {/* legs */}
                <line x1="12" y1="2" x2="8" y2="-18" stroke="#3a3550" strokeWidth="4" strokeLinecap="round" />
                <line x1="20" y1="2" x2="18" y2="-18" stroke="#3a3550" strokeWidth="4" strokeLinecap="round" />
                {/* body + head */}
                <rect x="8" y="-38" width="12" height="22" rx="4" fill="#b5495b" />
                <circle cx="14" cy="-46" r="6.5" fill="#e8c9a0" />
                {/* arms reach to the hands on the pole */}
                <line x1="14" y1="-32" x2="20" y2="-40" stroke="#e8c9a0" strokeWidth="3" strokeLinecap="round" />
                {/* the pole — rotates about the hands (20,-40) */}
                <g transform={`rotate(${poleDeg} 20 -40)`}>
                  <line x1="20" y1="-52" x2="20" y2="46" stroke="#caa46a" strokeWidth="3" strokeLinecap="round" />
                </g>
              </g>
            )}
          </g>

          {/* win sparkle */}
          {view.won && (
            <text x="200" y="60" textAnchor="middle" fontSize="18" fontWeight="700"
              fill="#fff3c4" style={{ letterSpacing: 1 }}>✦ the far bank ✦</text>
          )}
        </svg>
      </div>

      {/* progress down the river */}
      <div style={{ marginTop: 16, fontSize: 14, letterSpacing: 1, opacity: 0.7 }}>
        Down the river
      </div>
      <div style={{
        marginTop: 6, height: 16, borderRadius: 8, overflow: "hidden",
        background: "rgba(90,60,30,0.18)", border: "1px solid rgba(90,60,30,0.35)",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: "linear-gradient(90deg,#8a3d2a,#c77d4a)",
          transition: "width .25s ease",
        }} />
      </div>

      <div style={{
        marginTop: 8, fontSize: 15, fontStyle: "italic", minHeight: 20,
        color: view.won ? "#3c7a3c" : view.flash === "miss" || view.fallen ? "#8a3d2a" : "#2b2118",
      }}>
        {commentary(view)}
      </div>
    </div>
  );
}

function commentary(v: View): string {
  if (v.won) return "…gliding under the Bridge of Sighs — you made it.";
  if (v.fallen) return "SPLASH — into the river you go. Back to the near bank…";
  if (v.flash === "hit") return "…clean stroke — she surges forward…";
  if (v.flash === "miss") return "…mistimed! she wobbles…";
  return `${v.progress} clean strokes — wait for the pole to plant.`;
}

// A gentle scrolling ripple line across the river.
function ripple(y: number, off: number): string {
  const pts: string[] = [];
  for (let x = -20; x <= 420; x += 20) {
    const yy = y + Math.sin((x + off) * 0.09) * 2.2;
    pts.push(`${x === -20 ? "M" : "L"}${x} ${yy.toFixed(1)}`);
  }
  return pts.join(" ");
}

function wrap(v: number, w: number): number {
  return ((v % w) + w) % w;
}

function numParam(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const minigame: Minigame = {
  id: "punting",
  title: "Punting the river",
  instructions: "Space when the pole plants — mistime it and you fall in.",
  Component: PuntingGame,
};
export default minigame;
