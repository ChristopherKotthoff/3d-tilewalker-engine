import { setMinigameCheck } from "../store";
import type { Minigame } from "./types";

// Auto-discover every minigame: each file in games/ default-exports a Minigame.
// import.meta.glob(eager) means dropping a new file registers it with NO edit to
// this file — so parallel devs never touch a shared registration list (no merge
// conflicts). The trade-off: all games are bundled up front (they're tiny DOM
// components); switch to lazy `import()` here if that ever matters.
const modules = import.meta.glob<{ default: Minigame }>("./games/*.{ts,tsx}", {
  eager: true,
});

const registry = new Map<string, Minigame>();
for (const [path, mod] of Object.entries(modules)) {
  const mg = mod.default;
  if (!mg?.id || !mg.Component) {
    console.warn(`[minigames] ${path} has no valid default export {id, Component} — skipped`);
    continue;
  }
  if (registry.has(mg.id)) {
    console.warn(`[minigames] duplicate id "${mg.id}" (${path}) — keeping the first`);
    continue;
  }
  registry.set(mg.id, mg);
}

export function getMinigame(id: string): Minigame | undefined {
  return registry.get(id);
}

// Let the store ask "is this id registered?" without importing components.
setMinigameCheck((id) => registry.has(id));

if (import.meta.env.DEV) {
  (window as any).__minigames = () => [...registry.keys()];
}
