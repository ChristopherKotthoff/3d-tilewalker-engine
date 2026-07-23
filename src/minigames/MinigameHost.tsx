import { Component as ReactComponent, useEffect, useRef } from "react";
import { useGame } from "../store";
import { getMinigame } from "./registry";
import type { MinigameProps } from "./types";

// The shared window every minigame plays inside. Mounted from UI.tsx; renders only
// when phase === "minigame". Responsibilities that DON'T belong in any individual
// minigame live here once:
//   • open a modal overlay (pointer-events on, so the game is interactive)
//   • release pointer-lock so the cursor is usable
//   • stop keydown/keyup/wheel from reaching the main game (capture-phase eaters)
//   • provide onWin/onSkip that resume the stage's arrival outcome exactly once
//   • an always-available Skip (soft-fail) so a stuck/broken game never blocks
//   • an error boundary: a throwing minigame skips instead of white-screening
// Input muting for the 3D world is also enforced in World.tsx (canMove gates on
// phase === "playing"); sound muting is handled in Sound.tsx. This is defence in
// depth — the world already ignores movement, but eating the events here also
// stops them bubbling to any other listener while a game is up.
export function MinigameHost() {
  const phase = useGame((s) => s.phase);
  const active = useGame((s) => s.minigame);
  const finish = useGame((s) => s.finishMinigame);
  const config = useGame((s) => s.config);
  const stageIndex = useGame((s) => s.stageIndex);
  // Guard so a minigame calling onWin() then onSkip() (or twice) resumes only once.
  const done = useRef(false);

  const open = phase === "minigame" && !!active;

  // Swallow game inputs while a minigame is open. Capture phase so we intercept
  // before World's window-level listeners; we DON'T preventDefault/stop, so the
  // minigame's own React handlers (which listen in bubble phase on its own nodes)
  // still work — we only block the shared window/document listeners the main game
  // installs. Simplest correct approach: stopImmediatePropagation on window would
  // also kill the minigame's window listeners, so instead the main game already
  // gates on phase; here we just ensure pointer-lock is released and re-assert it
  // can't be grabbed. (World's useMouseLook only locks while phase === "playing".)
  useEffect(() => {
    if (!open) return;
    done.current = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }, [open, active]);

  if (!open || !active) return null;

  const mg = getMinigame(active.id);
  const stage = config?.quest[stageIndex];

  // Registered-but-vanished (hot-reload edge) or missing stage: skip immediately.
  if (!mg || !stage) {
    queueMicrotask(() => finish());
    return null;
  }

  const resume = () => {
    if (done.current) return;
    done.current = true;
    finish();
  };

  const Game = mg.Component;
  const props: MinigameProps = { params: active.params, stage, onWin: resume, onSkip: resume };

  return (
    <div style={S.backdrop}>
      <div style={S.window} className="cw-parchment cw-letter" role="dialog" aria-modal="true">
        <div style={S.header}>
          <div>
            <div style={S.eyebrow}>Minigame</div>
            <h2 style={S.title}>{mg.title}</h2>
            {mg.instructions && <div style={S.instructions}>{mg.instructions}</div>}
          </div>
          <button style={S.skip} className="cw-btn" onClick={resume} title="Skip this minigame">
            Skip →
          </button>
        </div>
        <div style={S.body}>
          <MinigameBoundary onError={resume}>
            <Game {...props} />
          </MinigameBoundary>
        </div>
      </div>
    </div>
  );
}

// A crashing minigame must not take the whole app down — catch, log, and skip
// (soft-fail, exactly like the player hitting Skip). Class component because
// error boundaries have no hook equivalent.
class MinigameBoundary extends ReactComponent<
  { onError: () => void; children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: unknown) {
    console.error("[minigame] crashed — skipping:", err);
    this.props.onError();
  }
  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

const INK = "#2b2118";
const SERIF_DISPLAY = "'Cormorant Garamond', 'IM Fell English SC', Georgia, serif";
const SERIF_BODY = "'EB Garamond', Georgia, 'Times New Roman', serif";

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "absolute", inset: 0, zIndex: 35,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(10,8,6,0.6)", backdropFilter: "blur(2px)",
    pointerEvents: "auto",
  },
  window: {
    position: "relative", width: "min(640px, 92vw)", maxHeight: "88vh",
    overflowY: "auto", padding: "26px 30px 30px", color: INK,
    fontFamily: SERIF_BODY, pointerEvents: "auto",
  },
  header: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    gap: 16, marginBottom: 16,
  },
  eyebrow: {
    fontFamily: SERIF_DISPLAY, fontSize: 13, letterSpacing: 3,
    textTransform: "uppercase", opacity: 0.6,
  },
  title: {
    fontFamily: SERIF_DISPLAY, fontWeight: 600, fontStyle: "italic",
    margin: "2px 0 0", fontSize: 30, lineHeight: 1.05, color: "#38271a",
  },
  instructions: { fontSize: 15, opacity: 0.75, marginTop: 4, fontStyle: "italic" },
  skip: {
    flexShrink: 0, cursor: "pointer", border: "1px solid rgba(90,60,30,0.5)",
    borderRadius: 2, padding: "7px 16px", fontSize: 13, letterSpacing: 1,
    fontFamily: SERIF_DISPLAY, fontWeight: 600, color: "#f4ead2",
    background: "linear-gradient(#8a3d2a,#6d2c1c)",
  },
  body: { minHeight: 120 },
};
