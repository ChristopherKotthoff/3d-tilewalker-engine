import { create } from "zustand";
import type { GameConfig, LatLng, Stage } from "./types";

export interface Item { icon: string; label: string; }

// The minigame registry lives in src/minigames/ (component-side). The store must
// not import React components, so it asks "is this id registered?" through this
// hook, which the registry sets at load. Until then / if unset, no minigame is
// registered and every orb falls straight through to its arrival outcome.
let hasMinigame: (id: string) => boolean = () => false;
export function setMinigameCheck(fn: (id: string) => boolean) { hasMinigame = fn; }

/** Normalise a stage's `minigame` field to {id, params} — or null if absent or
 * not registered (skip gracefully). */
function resolveMinigame(m: Stage["minigame"]): { id: string; params: Record<string, unknown> } | null {
  if (!m) return null;
  const { id, params } =
    typeof m === "string" ? { id: m, params: {} } : { id: m.id, params: m };
  return hasMinigame(id) ? { id, params: params as Record<string, unknown> } : null;
}

/** A stage has a story beat worth pausing for only if it has arrival content. */
function hasArrivalContent(stage: Stage): boolean {
  return !!(stage.arrivalTitle || stage.arrivalBody || stage.arrivalImage);
}

// Apply a stage's arrival outcome: teleport away, open the story letter, or (no
// arrival content) skip straight to the next stage. Shared by arrive() (no
// minigame) and finishMinigame() (after one), so the outcome is identical
// whether or not a minigame ran.
function applyArrival(
  stage: Stage,
  get: () => GameState,
  set: (partial: Partial<GameState>) => void,
) {
  if (stage.action === "teleport" && stage.teleportTo) {
    get().startTeleport(stage.teleportTo, stage.travelNote);
  } else if (hasArrivalContent(stage)) {
    set({ phase: "reading" });
  } else {
    get().next();
  }
}

// Live minimap channel: the world writes player/target world coords + player
// heading + camera yaw each frame; the minimap reads them in its own rAF loop.
// Deliberately NOT in the store — a per-frame store write would re-render the
// whole UI at 60fps. The map orients camera-up (camYaw); the player arrow turns
// with `heading` relative to it.
export const radar = { px: 0, pz: 0, heading: 0, camYaw: 0, tx: 0, tz: 0, lat: 0, lng: 0 };

export type Phase =
  | "loading" // fetching config / booting tiles
  | "intro" // title card, not yet playing
  | "playing" // walking around
  | "minigame" // a minigame modal is open (played on arrival, before teleport/letter)
  | "reading" // arrival modal open, movement paused
  | "teleporting" // fade-to-black warp in progress
  | "ended"; // final stage cleared

/** Active minigame: the registered id + the params passed to its component. */
export interface ActiveMinigame { id: string; params: Record<string, unknown>; }

interface GameState {
  config: GameConfig | null;
  stageIndex: number;
  phase: Phase;
  /** Set by the world when tiles under the player have streamed in. */
  groundReady: boolean;
  /** Live per-tile attribution string from Google (mandatory to display). */
  attribution: string;
  /** True while the player is driving the car (world writes it; UI reads it). */
  inCar: boolean;
  /** True while a boardable car is within enter range (world writes it; UI shows the E prompt). */
  carNear: boolean;
  /** True when a car has been summoned this stage (C key / debug) — makes any stage drivable. */
  carSummoned: boolean;
  /** Monotonic counter bumped on each summon; the world parks the car beside the player once per bump. */
  carSummonSeq: number;
  /** The minigame currently being played (phase === "minigame"), else null. */
  minigame: ActiveMinigame | null;
  /** Pending teleport destination while phase === "teleporting". */
  teleportTo: LatLng | null;
  /** Monotonic counter bumped on every teleport start. The world applies the
   * re-center in its frame loop (not a React effect) and tracks the last seq it
   * handled, so a fast same-city warp can't finish before the recenter runs. */
  teleportSeq: number;
  /** True when the pending teleport is a debug jump (resume "playing", not "reading"). */
  devWarp: boolean;
  /** Caption on the travel card during the current teleport. */
  travelNote: string;
  /** Collected running-gag items (socks, water bottle, protein shake…). */
  inventory: Item[];
  /** The "silly" meter — ticks up on goofy beats. */
  silly: number;
  /** Metres added to the grounded character height (tiles often sit below the
   * visual floor). Seeded from settings.heightOffset; live-tunable in Debug. */
  heightOffset: number;
  /** DEV: the debug panel is open. While true the orb won't fire arrivals and
   * the world won't re-grab pointer-lock, so debugging isn't interrupted. */
  debugOpen: boolean;
  /** True when launched via a /maps/dir/ URL — ephemeral, never persisted. */
  navMode: boolean;
  /** Nav beacon position; null once dismissed (player walked to it). */
  navTarget: LatLng | null;
  /** Nav start position — where to warp the player on first play. */
  navStart: LatLng | null;

  setConfig: (c: GameConfig) => void;
  setDebugOpen: (v: boolean) => void;
  setHeightOffset: (v: number) => void;
  setPhase: (p: Phase) => void;
  setGroundReady: (v: boolean) => void;
  setAttribution: (s: string) => void;
  setInCar: (v: boolean) => void;
  setCarNear: (v: boolean) => void;
  /** Summon a drivable car beside the player (C key / debug button). */
  summonCar: () => void;
  startGame: () => void;
  /** Player entered the active glow. */
  arrive: () => void;
  /** Minigame finished (won or skipped): apply the stage's original arrival outcome. */
  finishMinigame: () => void;
  startTeleport: (to: LatLng, note?: string) => void;
  /** Debug: warp anywhere on Earth and resume walking (no arrival modal). */
  devTeleport: (to: LatLng) => void;
  /** Seed a nav route from a /maps/dir/ URL (ephemeral, never written to localStorage). */
  setNavRoute: (start: LatLng, target: LatLng) => void;
  /** Dismiss the nav beacon after the player reaches it. */
  clearNavBeacon: () => void;
  /** Debug: jump to any stage (back/forward/replay) and warp to where it begins. */
  devJumpToStage: (index: number) => void;
  finishTeleport: () => void;
  /** Dismiss arrival modal, advance to next stage (or end). */
  next: () => void;
  restart: () => void;
}

export const useGame = create<GameState>((set, get) => ({
  config: null,
  stageIndex: 0,
  phase: "loading",
  groundReady: false,
  attribution: "",
  inCar: false,
  carNear: false,
  carSummoned: false,
  carSummonSeq: 0,
  minigame: null,
  teleportTo: null,
  teleportSeq: 0,
  devWarp: false,
  travelNote: "",
  inventory: [],
  silly: 0,
  heightOffset: 0,
  debugOpen: false,
  navMode: false,
  navTarget: null,
  navStart: null,

  setConfig: (config) => {
    // ponytail: resume at the saved stage (persisted below); clamp to valid range.
    const saved = parseInt(localStorage.getItem("cw:stage") ?? "", 10);
    const stageIndex = Number.isInteger(saved) && saved > 0 && saved < config.quest.length ? saved : 0;
    set({ config, heightOffset: config.settings.heightOffset ?? 0, stageIndex });
  },
  setDebugOpen: (debugOpen) => set({ debugOpen }),
  setHeightOffset: (heightOffset) => set({ heightOffset }),
  setPhase: (phase) => set({ phase }),
  setGroundReady: (groundReady) => set({ groundReady }),
  setAttribution: (attribution) => set({ attribution }),
  setInCar: (inCar) => set({ inCar }),
  setCarNear: (carNear) => set({ carNear }),
  summonCar: () => set((s) => ({ carSummoned: true, carSummonSeq: s.carSummonSeq + 1 })),

  startGame: () => set({ phase: "playing" }),

  arrive: () => {
    const { config, stageIndex, inventory, silly } = get();
    if (!config) return;
    const stage = config.quest[stageIndex];
    if (!stage) return;
    // Reaching a beacon can grant a collectible and bump the silly meter.
    if (stage.grantItem && !inventory.some((i) => i.label === stage.grantItem!.label))
      set({ inventory: [...inventory, stage.grantItem] });
    if (stage.silly) set({ silly: silly + stage.silly });
    // If this orb has a registered minigame, play it first (before teleport/letter).
    // A minigame authored on the stage but not registered (typo, or a sibling dev's
    // game not merged yet) is skipped — the story must never block.
    const mg = resolveMinigame(stage.minigame);
    if (mg) {
      set({ phase: "minigame", minigame: mg });
      return;
    }
    applyArrival(stage, get, set);
  },

  finishMinigame: () => {
    const { config, stageIndex } = get();
    set({ minigame: null });
    const stage = config?.quest[stageIndex];
    if (stage) applyArrival(stage, get, set);
    else set({ phase: "playing" });
  },

  startTeleport: (to, note = "") =>
    set((s) => ({ phase: "teleporting", teleportTo: to, teleportSeq: s.teleportSeq + 1,
                  groundReady: false, devWarp: false, travelNote: note, carSummoned: false })),

  devTeleport: (to) =>
    set((s) => ({ phase: "teleporting", teleportTo: to, teleportSeq: s.teleportSeq + 1,
                  groundReady: false, devWarp: true, travelNote: "", carSummoned: false })),

  setNavRoute: (start, target) => set({ navMode: true, navStart: start, navTarget: target }),
  clearNavBeacon: () => set({ navTarget: null }),

  devJumpToStage: (index) => {
    const { config } = get();
    if (!config) return;
    const i = Math.max(0, Math.min(index, config.quest.length - 1));
    // Where the target stage begins: its own spawn (stage 0), else the city the
    // previous stage warps to (teleport stages), else the previous glow's spot.
    const prev = config.quest[i - 1];
    const here =
      config.quest[i].spawn ??
      (prev ? prev.teleportTo ?? prev.target : config.quest[i].target);
    set((s) => ({ stageIndex: i, teleportTo: here, teleportSeq: s.teleportSeq + 1,
                  phase: "teleporting", groundReady: false, devWarp: true, travelNote: "", carSummoned: false }));
  },

  // Called by the world once tiles at the destination have loaded.
  finishTeleport: () => {
    const { devWarp, config, stageIndex } = get();
    set({ devWarp: false });
    if (devWarp) { set({ phase: "playing" }); return; }
    // Show the arrival letter, or (no content) skip straight to the next stage.
    const stage = config?.quest[stageIndex];
    if (stage && hasArrivalContent(stage)) set({ phase: "reading" });
    else get().next();
  },

  next: () => {
    const { config, stageIndex } = get();
    if (!config) return;
    if (stageIndex >= config.quest.length - 1) {
      set({ phase: "ended" });
    } else {
      set({ stageIndex: stageIndex + 1, phase: "playing", teleportTo: null, carSummoned: false });
    }
  },

  restart: () => {
    localStorage.removeItem("cw:stage"); // ponytail: "Walk again" starts fresh
    set({ stageIndex: 0, phase: "intro", teleportTo: null, groundReady: false,
          inventory: [], silly: 0, travelNote: "", minigame: null });
  },
}));

// Persist the current stage so a reload resumes where the player was (Feature 1).
useGame.subscribe((s, prev) => {
  if (s.stageIndex !== prev.stageIndex) localStorage.setItem("cw:stage", String(s.stageIndex));
});

// Dev aid: expose the store so you can inspect/drive game state from the console.
if (import.meta.env.DEV) (window as any).__game = useGame;
