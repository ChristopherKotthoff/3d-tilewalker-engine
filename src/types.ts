export interface LatLng {
  lat: number; // degrees
  lng: number; // degrees
}

export type StageAction = "show_clue" | "teleport";

/** Chris's role for a stage: gone, waiting at a fixed spot, or following the player. */
export type CompanionRole = "hidden" | "follow" | LatLng;

export interface Stage {
  id: number;
  /** Optional chapter/act label shown on the clue card (e.g. "Chapter 0 · Tokyo"). */
  chapter?: string;
  /** The riddle/instruction telling the player where to walk. Shown persistently. */
  clueTitle: string;
  clueBody: string;
  /** Optional image (URL or /public path) shown in the clue card. */
  clueImage?: string;
  /** Where this stage's glow marker sits (the answer to the clue). */
  target: LatLng;
  /** Trigger radius override in metres (horizontal). Falls back to settings.triggerRadius. */
  triggerRadius?: number;
  glowStyle?: "normal" | "teleport";
  glowColor?: string; // CSS/hex colour for the glow
  /** Render this stage at night (dark sky + dim, cool lighting) instead of day. */
  night?: boolean;
  action: StageAction;
  /** teleport only: where the player is warped to. */
  teleportTo?: LatLng;
  /** stage 0 only: where the player first spawns. */
  spawn?: LatLng;
  /** Chris this stage: "follow" (default), "hidden", or a fixed {lat,lng} he waits at. */
  companion?: CompanionRole;
  /** Force Chris's idle clip this stage (e.g. "All_Night_Dance", "Wave_One_Hand", "Sit_and_Drink"). */
  companionClip?: string;
  /** teleport stages: which vehicle carries her — draws the model at the boarding orb.
   * "train" = no model (walk to station → teleport), matching the design's travel rule. */
  vehicle?: "plane" | "flixbus" | "car" | "bicycle" | "train";
  /** Optional minigame played in a modal window when this orb is reached, BEFORE
   * any teleport/letter. Either a registered minigame `id` (see src/minigames/), or
   * `{ id, ...params }` whose extra fields are passed to the component as `params`.
   * An unregistered id is skipped gracefully (the story never blocks). */
  minigame?: string | ({ id: string } & Record<string, unknown>);
  /** Caption shown on the fade-to-black travel card during a teleport. */
  travelNote?: string;
  /** Collectible added to the HUD when this beacon is reached. */
  grantItem?: { icon: string; label: string };
  /** Bumps the "silly" meter by this much on arrival. */
  silly?: number;
  /** Optional story beat shown in a modal when the glow is entered. */
  arrivalTitle?: string;
  arrivalBody?: string;
  /** Optional image (URL or /public path) shown in the arrival modal. */
  arrivalImage?: string;
}

/**
 * A single sound cue. All cues fade in/out smoothly (see `fade`). The cue's
 * behaviour is derived from which anchor it has:
 *   - neither `at` nor `follow`  → ambient (non-positional, fills the scene)
 *   - `at: {lat,lng}`            → positional sound fixed at a world point
 *   - `follow: "..."`            → positional sound tracking a moving thing
 * Any cue can be gated to `stages` and/or made audible only within `proximity`
 * metres of its anchor (story beats: "play when the player nears X"). A cue with
 * `trigger` is a one-shot fired by that event instead of looping.
 */
export interface SoundCue {
  id: string;
  src?: string; // URL or /public path (e.g. "/audio/wind.mp3"). Omitted for `pool` cues.
  volume?: number; // target gain when active, 0..1 (default 0.6)
  loop?: boolean; // default true (ignored for triggers)
  fade?: number; // fade in/out seconds (default 1.5)
  refDistance?: number; // positional: full-volume radius (default 12)
  maxDistance?: number; // positional: silent beyond this (default 120)
  at?: LatLng; // fixed positional point
  /** Moving positional anchor. "beacon" = the current stage's glow. */
  follow?: "player" | "companion" | "car" | "beacon";
  stages?: number[]; // only active during these stage indices (default: all)
  proximity?: number; // only audible within this many metres of its anchor
  /** One-shot: "arrival" fires at a beacon; "proximity" fires on entering `proximity` of the anchor. */
  trigger?: "arrival" | "proximity";
  /** Random-clip player: srcs to pick from; plays one at random every `every` seconds (positional if `follow`/`at`). */
  pool?: string[];
  /** [minSeconds, maxSeconds] between `pool` plays (default [15, 20]). */
  every?: [number, number];
}

export interface GameConfig {
  title: string;
  intro?: string;
  introImage?: string;
  ending?: string;
  endingImage?: string;
  settings: {
    triggerRadius: number; // metres
    moveSpeed: number; // metres / second
    /** max screen-space error; higher = lower detail, faster streaming */
    errorTarget?: number;
    /** metres added to the grounded character height — nudge her up out of the
     * street mesh (Google tiles often ground slightly below the visual floor).
     * Live-tunable in the debug panel (§12); dial it in, then paste the value. */
    heightOffset?: number;
  };
  /** Optional soundscape (ambient / positional / entity / story cues). */
  sounds?: SoundCue[];
  quest: Stage[];
}
