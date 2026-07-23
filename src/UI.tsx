import { useGame } from "./store";
import { Debug } from "./Debug";
import { Minimap } from "./Minimap";
import { MinigameHost } from "./minigames/MinigameHost";

export function UI() {
  const config = useGame((s) => s.config);
  const phase = useGame((s) => s.phase);
  const stageIndex = useGame((s) => s.stageIndex);
  const attribution = useGame((s) => s.attribution);
  const inventory = useGame((s) => s.inventory);
  const silly = useGame((s) => s.silly);
  const carNear = useGame((s) => s.carNear);
  const inCar = useGame((s) => s.inCar);
  const travelNote = useGame((s) => s.travelNote);
  const startGame = useGame((s) => s.startGame);
  const next = useGame((s) => s.next);
  const restart = useGame((s) => s.restart);

  if (!config) {
    return <Center><h2 style={{ color: "#fff" }}>Loading…</h2></Center>;
  }

  const stage = config.quest[stageIndex];
  const total = config.quest.length;

  return (
    <>
      {/* Persistent clue card — a little parchment note pinned top-left */}
      {(phase === "playing" || phase === "reading") && stage && (
        <div style={S.clue} className="cw-parchment">
          <div style={S.clueTag}>{stage.chapter ?? `· Clue ${stageIndex + 1} of ${total} ·`}</div>
          <h2 style={S.clueTitle}>{stage.clueTitle}</h2>
          <div style={S.rule} />
          {stage.clueImage && (
            <img src={stage.clueImage} alt="" style={S.clueImg} className="cw-photo" />
          )}
          <p style={S.clueBody}>{stage.clueBody}</p>
        </div>
      )}

      {/* Controls hint */}
      {phase === "playing" && (
        <div style={S.hint}>
          WASD move · Shift run · click + mouse for camera, esc to undo · scroll zoom · H if stuck · G to see on Google Maps
        </div>
      )}

      {/* Enter-car prompt — only when a boardable car is nearby (or while driving) */}
      {phase === "playing" && (carNear || inCar) && (
        <div style={S.carPrompt}>
          <kbd style={S.kbd}>E</kbd> {inCar ? "exit car" : "enter car"}
        </div>
      )}

      {/* Fade-to-black teleport veil (also covers ground-loading after warp — held
          up until the destination ground has genuinely settled, see World.tsx). A
          slow pulsing spinner reassures it's still working rather than frozen. */}
      <div
        style={{
          ...S.veil,
          opacity: phase === "teleporting" ? 1 : 0,
          pointerEvents: phase === "teleporting" ? "auto" : "none",
        }}
      >
        <div style={S.veilInner}>
          <div className="cw-spinner" style={S.spinner} />
          <div style={S.veilText}>{travelNote || "· travelling ·"}</div>
        </div>
      </div>

      {/* HUD: collected items + the "silly" meter (bottom-right, out of the way) */}
      {(phase === "playing" || phase === "reading") && (inventory.length > 0 || silly > 0) && (
        <div style={S.hud}>
          {inventory.map((it) => (
            <span key={it.label} title={it.label} style={S.item}>{it.icon}</span>
          ))}
          {silly > 0 && <span style={S.silly}>silly ×{silly}</span>}
        </div>
      )}

      {/* Arrival / story-beat letter */}
      {phase === "reading" && stage && (
        <Center>
          <Letter
            eyebrow={`Beacon ${stageIndex + 1} of ${total} reached`}
            title={stage.arrivalTitle ?? "You made it."}
            image={stage.arrivalImage}
            body={stage.arrivalBody ?? ""}
            action={stageIndex >= total - 1 ? "Finish" : "Continue →"}
            onAction={next}
          />
        </Center>
      )}

      {/* Intro letter */}
      {phase === "intro" && (
        <Center>
          <Letter
            eyebrow="An invitation"
            title={config.title}
            image={config.introImage}
            body={config.intro ?? ""}
            action="Start our Story"
            onAction={startGame}
          />
        </Center>
      )}

      {/* Ending letter */}
      {phase === "ended" && (
        <Center>
          <Letter
            eyebrow="Finis"
            title="The end"
            image={config.endingImage}
            body={config.ending ?? ""}
            action="Walk again"
            onAction={restart}
          />
        </Center>
      )}

      {/* Mandatory Google attribution (design §9) — always visible */}
      <div style={S.attribution}>
        <span style={S.googleLogo}>Google</span>
        <span style={S.credits}>{attribution || "Photorealistic 3D Tiles"}</span>
      </div>

      <Minimap />

      {/* Minigame window — self-gates on phase === "minigame"; renders above the
          world, freezes input + mutes game sound while a game is played. */}
      <MinigameHost />

      {import.meta.env.DEV && <Debug />}
    </>
  );
}

// A decorated parchment letter: eyebrow, ornamental title, optional framed image,
// a drop-capped body, and a wax-button call to action.
function Letter({
  eyebrow, title, body, image, action, onAction,
}: {
  eyebrow: string; title: string; body: string;
  image?: string; action: string; onAction: () => void;
}) {
  const first = body.slice(0, 1);
  const rest = body.slice(1);
  return (
    <div style={S.letter} className="cw-parchment cw-letter">
      <div style={S.eyebrow}>{eyebrow}</div>
      <h1 style={S.letterTitle}>{title}</h1>
      <div style={S.flourish}>❧</div>
      {image && <img src={image} alt="" style={S.letterImg} className="cw-photo" />}
      <p style={S.letterBody}>
        {body && <span style={S.dropcap}>{first}</span>}
        {rest}
      </p>
      <button style={S.btn} className="cw-btn" onClick={onAction}>{action}</button>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={S.center}>{children}</div>;
}

// Aged-paper palette + serif faces (loaded in index.html). The .cw-* classes in
// the injected stylesheet below carry the effects inline styles can't express
// (::first-letter, box-shadow layering, hover) — keeps the parchment look in one
// place and general for any future note.
const INK = "#2b2118";
const SERIF_DISPLAY = "'Cormorant Garamond', 'IM Fell English SC', Georgia, serif";
const SERIF_BODY = "'EB Garamond', Georgia, 'Times New Roman', serif";

const S: Record<string, React.CSSProperties> = {
  center: {
    position: "absolute", inset: 0, display: "flex",
    alignItems: "center", justifyContent: "center",
    pointerEvents: "none", zIndex: 20,
  },

  // ---- pinned clue note ----
  clue: {
    position: "absolute", top: 18, left: 18, maxWidth: 320,
    padding: "18px 22px 20px", color: INK,
    fontFamily: SERIF_BODY, zIndex: 10,
    transform: "rotate(-0.6deg)",
  },
  clueTag: {
    fontFamily: SERIF_DISPLAY, fontSize: 13, letterSpacing: 2,
    textTransform: "uppercase", opacity: 0.65, textAlign: "center",
  },
  clueTitle: {
    fontFamily: SERIF_DISPLAY, fontWeight: 600, margin: "2px 0 0",
    fontSize: 25, lineHeight: 1.1, textAlign: "center", color: "#3a2a1c",
  },
  rule: {
    height: 0, borderTop: "1px solid rgba(90,60,30,0.35)",
    width: "60%", margin: "10px auto 12px",
  },
  clueImg: {
    width: "100%", maxHeight: 200, objectFit: "cover", display: "block", marginBottom: 12,
  },
  clueBody: {
    margin: 0, fontSize: 16.5, lineHeight: 1.55, fontStyle: "italic",
    whiteSpace: "pre-line", // honor \n in game.json as line breaks
  },

  hint: {
    position: "absolute", bottom: 44, left: "50%", transform: "translateX(-50%)",
    color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "system-ui, sans-serif",
    background: "rgba(0,0,0,0.35)", padding: "6px 14px", borderRadius: 20, zIndex: 10,
  },

  carPrompt: {
    position: "absolute", bottom: 84, left: "50%", transform: "translateX(-50%)",
    display: "flex", alignItems: "center", gap: 8, zIndex: 11,
    color: "#fff", fontSize: 15, fontFamily: "system-ui, sans-serif",
    background: "rgba(0,0,0,0.5)", padding: "8px 16px", borderRadius: 22,
  },
  kbd: {
    display: "inline-block", minWidth: 22, textAlign: "center",
    padding: "2px 7px", borderRadius: 6, fontWeight: 700,
    background: "#f4ead2", color: "#2b2118",
    boxShadow: "0 2px 0 rgba(0,0,0,0.4)",
  },

  veil: {
    position: "absolute", inset: 0, background: "#000",
    transition: "opacity 1s ease", zIndex: 30,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  veilInner: { display: "flex", flexDirection: "column", alignItems: "center", gap: 22 },
  veilText: { color: "#e7d3a8", letterSpacing: 2, fontFamily: SERIF_DISPLAY, fontSize: 22, fontStyle: "italic", maxWidth: "70vw", textAlign: "center", lineHeight: 1.5 },
  spinner: {
    width: 34, height: 34, borderRadius: "50%",
    border: "2px solid rgba(231,211,168,0.25)", borderTopColor: "#e7d3a8",
  },

  hud: {
    position: "absolute", bottom: 44, right: 18, zIndex: 10,
    display: "flex", alignItems: "center", gap: 8,
    background: "rgba(0,0,0,0.35)", padding: "6px 12px", borderRadius: 20,
    fontFamily: SERIF_BODY,
  },
  item: { fontSize: 22, lineHeight: 1, cursor: "default", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" },
  silly: {
    color: "#ffd9a8", fontFamily: SERIF_DISPLAY, fontStyle: "italic", fontSize: 15,
    letterSpacing: 1,
  },

  // ---- full-screen letter ----
  letter: {
    pointerEvents: "auto", position: "relative",
    width: "min(560px, 88vw)", maxHeight: "86vh", overflowY: "auto",
    padding: "40px 48px 44px", color: INK, textAlign: "center",
    fontFamily: SERIF_BODY,
  },
  eyebrow: {
    fontFamily: SERIF_DISPLAY, fontSize: 14, letterSpacing: 4,
    textTransform: "uppercase", opacity: 0.6,
  },
  letterTitle: {
    fontFamily: SERIF_DISPLAY, fontWeight: 600, fontStyle: "italic",
    margin: "6px 0 2px", fontSize: 44, lineHeight: 1.05, color: "#38271a",
  },
  flourish: { fontFamily: SERIF_DISPLAY, fontSize: 26, opacity: 0.55, margin: "2px 0 14px" },
  letterImg: {
    width: "78%", maxHeight: "42vh", objectFit: "cover", display: "block", margin: "0 auto 20px",
  },
  letterBody: {
    margin: "0 0 26px", fontSize: 19, lineHeight: 1.62, textAlign: "left",
    whiteSpace: "pre-line", // honor \n in game.json as line breaks
  },
  dropcap: {
    float: "left", fontFamily: SERIF_DISPLAY, fontWeight: 600,
    fontSize: 62, lineHeight: 0.72, paddingRight: 8, paddingTop: 6,
    color: "#7a3b1d",
  },
  btn: {
    pointerEvents: "auto", cursor: "pointer", border: "1px solid rgba(90,60,30,0.5)",
    borderRadius: 2, padding: "11px 30px", fontSize: 16, letterSpacing: 1,
    fontFamily: SERIF_DISPLAY, fontWeight: 600, color: "#f4ead2",
    background: "linear-gradient(#8a3d2a,#6d2c1c)",
  },

  attribution: {
    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 40,
    display: "flex", alignItems: "center", gap: 8,
    padding: "3px 8px", background: "rgba(0,0,0,0.45)",
    fontFamily: "system-ui, sans-serif", fontSize: 11, color: "#fff",
    pointerEvents: "none",
  },
  googleLogo: { fontWeight: 700, letterSpacing: 0.5 },
  credits: { opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};

// Effects that inline styles can't do (paper texture, torn shadow, framed photo,
// button hover). Injected once. `.cw-parchment` is the aged-paper surface used by
// both the pinned note and the full letters.
const CSS = `
.cw-parchment {
  background:
    radial-gradient(120% 120% at 30% 0%, rgba(255,251,235,0.55), rgba(0,0,0,0) 60%),
    radial-gradient(90% 90% at 100% 100%, rgba(120,80,30,0.16), rgba(0,0,0,0) 55%),
    linear-gradient(155deg, #f6ecd2 0%, #efe1c0 45%, #e7d3a8 100%);
  border: 1px solid rgba(120,84,40,0.35);
  border-radius: 3px;
  box-shadow:
    0 2px 0 rgba(255,255,255,0.4) inset,
    0 -18px 40px -24px rgba(90,55,20,0.5) inset,
    0 14px 36px rgba(0,0,0,0.5);
}
.cw-letter::before,
.cw-letter::after {
  content: ""; position: absolute; left: 14px; right: 14px; height: 12px;
  border: 1px solid rgba(120,84,40,0.35); border-left: none; border-right: none;
  pointer-events: none;
}
.cw-letter::before { top: 12px; }
.cw-letter::after  { bottom: 12px; }
.cw-photo {
  border: 6px solid #fbf5e6;
  box-shadow: 0 6px 18px rgba(40,25,10,0.45);
  border-radius: 1px;
}
.cw-btn { transition: transform .12s ease, box-shadow .12s ease, filter .12s ease; }
.cw-btn:hover { filter: brightness(1.08); box-shadow: 0 6px 16px rgba(90,30,15,0.5); transform: translateY(-1px); }
.cw-btn:active { transform: translateY(0); }
/* thin custom scrollbar for long letters */
.cw-letter::-webkit-scrollbar { width: 8px; }
.cw-letter::-webkit-scrollbar-thumb { background: rgba(120,84,40,0.4); border-radius: 4px; }
/* teleport-veil loading spinner (parchment gold ring on black) */
@keyframes cw-spin { to { transform: rotate(360deg); } }
.cw-spinner { animation: cw-spin 1s linear infinite; }
`;
if (typeof document !== "undefined" && !document.getElementById("cw-note-style")) {
  const el = document.createElement("style");
  el.id = "cw-note-style";
  el.textContent = CSS;
  document.head.appendChild(el);
}
