import type { Stage } from "../types";

/**
 * The contract every minigame implements. A minigame is a self-contained React
 * component rendered inside the shared modal window (see MinigameHost.tsx) while
 * the main game is frozen. It is fully isolated: it must NOT import the game store
 * or touch the 3D world — everything it needs arrives via props, and it reports
 * back only through `onWin` / `onSkip`. That isolation is what lets several people
 * build different minigames in parallel without touching a shared file.
 */
export interface MinigameProps {
  /** Params from game.json — the object form of `stage.minigame` (minus `id`),
   * or `{}` for the bare-string form. Type-narrow/validate these yourself. */
  params: Record<string, unknown>;
  /** The stage this minigame is attached to (for titles, images, flavour text). */
  stage: Stage;
  /** Call when the player clears the game. Resumes the stage's arrival outcome
   * (teleport or letter). Idempotent-safe: the host ignores repeat calls. */
  onWin: () => void;
  /** Call to bail out (the shared Skip button does this). Soft-fail: also resumes
   * the arrival outcome — losing never blocks the story. Same effect as onWin. */
  onSkip: () => void;
}

/** A registered minigame. Drop a file in src/minigames/games/ default-exporting
 * one of these; the registry auto-discovers it (no central edit → no merge
 * conflicts). `id` must be unique and is what game.json references. */
export interface Minigame {
  /** Unique key referenced by `stage.minigame` in game.json. */
  id: string;
  /** Shown in the modal header. */
  title: string;
  /** The playable component. */
  Component: React.ComponentType<MinigameProps>;
  /** Optional one-line instruction shown under the title. */
  instructions?: string;
}
