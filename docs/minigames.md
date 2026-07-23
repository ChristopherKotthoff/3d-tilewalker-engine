# Minigames

A stage can host a **minigame**, a modal game played the moment you reach the
beacon, before any teleport or letter. Minigames are fully isolated React
components, so several people can build different ones in parallel without touching
a shared file.

The demo ships one: [`src/minigames/games/punting.tsx`](../src/minigames/games/punting.tsx),
a Space-in-rhythm poling game wired to stage 3 of the Zürich walk. Copy it as your
template.

---

## Add one (the whole workflow)

1. **Copy the reference game:**
   ```
   src/minigames/games/punting.tsx  →  src/minigames/games/<your-id>.tsx
   ```
2. **Change the `id` and `title`, build your UI, and call `props.onWin()`** when
   the player clears it.
3. **Reference it from a stage** in `public/game.json`:
   ```jsonc
   { "id": 4, "clueTitle": "...", "target": {…}, "action": "show_clue",
     "minigame": "<your-id>" }
   ```
   Or pass params with the object form; extra fields arrive as `props.params`:
   ```jsonc
   "minigame": { "id": "<your-id>", "strokes": 10 }
   ```

That's it. There is no registration step. [`registry.ts`](../src/minigames/registry.ts)
auto-discovers every `games/*.tsx` via `import.meta.glob(..., { eager: true })`.
Deleting a file removes the game just as cleanly.

---

## The contract

Each file default-exports a `Minigame` ([`types.ts`](../src/minigames/types.ts)):

```ts
export interface Minigame {
  id: string;                              // globally unique; what game.json references
  title: string;                           // shown in the modal header
  Component: React.ComponentType<MinigameProps>;
  instructions?: string;                   // optional one-liner under the title
}
```

The `Component` receives:

```ts
export interface MinigameProps {
  params: Record<string, unknown>; // the object form of stage.minigame (minus id), or {}
  stage: Stage;                    // the stage it's attached to (titles, images, flavour)
  onWin: () => void;               // clear the game; resumes the stage's arrival outcome
  onSkip: () => void;              // bail out; same effect (soft-fail; skipping always allowed)
}
```

Two rules keep games independent. First, a minigame must not import the store or
the 3D world; everything it needs arrives via `props`, and it reports back only
through `onWin` / `onSkip`. Second, `onWin` and `onSkip` both resume the stage's
normal arrival outcome (a teleport or a letter), so losing never blocks the story.
Treat a minigame as a keepsake, not a difficulty gate.

---

## What the host handles for you

[`MinigameHost.tsx`](../src/minigames/MinigameHost.tsx) owns everything
cross-cutting, so your game stays tiny. It opens the modal and releases
pointer-lock, provides the always-available **Skip** button, guards `onWin`/`onSkip`
so they fire once, and wraps your component in an error boundary so a throwing
minigame skips instead of white-screening.

While a minigame is open the main game is frozen: movement is gated on
`phase === "playing"`, the camera won't grab pointer-lock, and the world's audio is
muted. Your game's own audio, if it has any, is unaffected.

An unregistered `minigame` id (a typo, or a game not merged yet) is skipped
gracefully: the stage falls straight through to its arrival outcome, so the story
never blocks. `window.__minigames()` (dev) lists the registered ids.
