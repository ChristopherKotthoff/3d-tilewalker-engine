# Authoring `game.json`

The entire game lives in [`public/game.json`](../public/game.json). It's fetched at
runtime rather than imported, so editing it hot-reloads the page with no rebuild.
The authoritative types are in [`src/types.ts`](../src/types.ts); this page is the
human-readable version.

Minimal valid file:

```jsonc
{
  "title": "My Walk",
  "settings": { "triggerRadius": 12, "moveSpeed": 6 },
  "quest": [
    {
      "id": 1,
      "clueTitle": "First clue",
      "clueBody": "Walk to the fountain.",
      "spawn":  { "lat": 47.3779, "lng": 8.5403 },
      "target": { "lat": 47.3698, "lng": 8.5389 },
      "action": "show_clue"
    }
  ]
}
```

---

## Top level (`GameConfig`)

| Field | Type | Notes |
|---|---|---|
| `title` | string | **Required.** Shown on the intro card. |
| `intro` | string | Intro letter text. |
| `introImage` | string | Image path/URL on the intro card. |
| `ending` | string | Ending letter shown after the final stage. |
| `endingImage` | string | Image on the ending card. |
| `settings` | object | **Required.** See below. |
| `sounds` | `SoundCue[]` | Optional soundscape. See [Sounds](#sounds). |
| `quest` | `Stage[]` | **Required.** The ordered list of stages. |

### `settings`

| Field | Type | Notes |
|---|---|---|
| `triggerRadius` | number | **Required.** Metres you must get within a beacon to trigger it. A per-stage `triggerRadius` overrides this. |
| `moveSpeed` | number | **Required.** Walking speed, metres/second. |
| `errorTarget` | number | Tile screen-space error. Higher means lower detail and faster streaming. About 24 is a good default. |
| `heightOffset` | number | Metres to lift the grounded character out of the street mesh, since Google tiles often ground slightly low. Tune it live with the debug panel's Height slider (`P`), then paste the value here. |

---

## A stage (`Stage`)

Only `id`, `clueTitle`, `clueBody`, `target`, and `action` are required.

| Field | Type | Notes |
|---|---|---|
| `id` | number | **Required.** Unique stage id (1-based by convention). |
| `clueTitle` | string | **Required.** Heading on the clue card. |
| `clueBody` | string | **Required.** The riddle or instruction, shown while walking. |
| `clueImage` | string | Optional image in the clue card. |
| `target` | `{lat,lng}` | **Required.** Where this stage's glow beacon sits. |
| `action` | `"show_clue"` \| `"teleport"` | **Required.** What reaching the beacon does. |
| `spawn` | `{lat,lng}` | First stage only. Where the player starts. |
| `triggerRadius` | number | Per-stage override of `settings.triggerRadius`. |
| `glowColor` | string | CSS/hex colour of the beacon. |
| `glowStyle` | `"normal"` \| `"teleport"` | `"teleport"` gives a distinct spinning look. |
| `night` | boolean | Render this stage at night (dark sky, cool dim light). |
| `teleportTo` | `{lat,lng}` | Teleport stages only. The destination the player is warped to. |
| `companion` | `"follow"` \| `"hidden"` \| `{lat,lng}` | Companion behaviour: trails you (default), absent, or waits at a fixed point. A fixed `{lat,lng}` must be in the current city, so don't use it on a teleport stage. |
| `companionClip` | string | Force the companion's idle animation this stage (e.g. `"Wave_One_Hand"`, `"Sit_and_Drink"`, `"All_Night_Dance"`, `"Agree_Gesture"`). |
| `vehicle` | `"plane"` \| `"car"` \| `"train"` \| … | Draws a boardable vehicle on the beacon. `"car"` is the drivable car (`Car.tsx`); `"plane"` ships as an example (`Vehicle.tsx`). Unmapped kinds render nothing. |
| `minigame` | string \| `{id, ...params}` | A modal minigame played on arrival, before the teleport or letter. See [Minigames](minigames.md). Unknown ids are skipped gracefully. |
| `travelNote` | string | Caption on the fade-to-black card during a teleport. |
| `grantItem` | `{icon, label}` | Adds a collectible to the HUD on arrival (e.g. `{"icon":"🍫","label":"Chocolate"}`). |
| `silly` | number | Bumps the on-screen "silly" meter by this much. |
| `chapter` | string | Label shown on the clue card (e.g. `"Zürich · 1 / 6"`). Purely cosmetic. |
| `arrivalTitle` / `arrivalBody` | string | Story-beat letter shown when the beacon is entered. A stage with no arrival content skips straight to the next stage. |
| `arrivalImage` | string | Image in the arrival letter. |

### Coordinates

All positions are `{ "lat": <deg>, "lng": <deg> }`. The easiest way to get good
ones: run in dev, press `P`, walk to the spot, and click **REMEMBER**. Copy-ready
lat/lng lands in the browser console. You can also WARP to any lat/lng from the
same panel to scout a location.

---

## Sounds

Each `SoundCue` in `sounds[]` becomes a Three.js audio node that fades in and out
each frame based on where you are. **The cue's kind is inferred from its anchor:**

- **neither `at` nor `follow`** → ambient (fills the scene, e.g. wind).
- **`at: {lat,lng}`** → positional, fixed at a world point.
- **`follow: "player" | "companion" | "car" | "beacon"`** → positional, tracking
  that moving thing (`"beacon"` is the current stage's glow).

| Field | Type | Notes |
|---|---|---|
| `id` | string | **Required.** Unique. |
| `src` | string | Audio file path. Omit only for `pool` cues. |
| `volume` | number | Target gain 0..1 (default 0.6). This is a linear multiplier, not perceptual loudness, so normalise your files rather than guessing per cue. |
| `loop` | boolean | Default true (ignored for triggers). |
| `fade` | number | Fade in/out seconds (default 1.5). |
| `at` / `follow` | | The anchor. See above. |
| `refDistance` / `maxDistance` | number | Positional falloff: full volume within `refDistance`, silent beyond `maxDistance`. |
| `stages` | number[] | Only active on these stage **indices**. See the gotcha below. |
| `proximity` | number | Only audible within this many metres of the anchor. |
| `trigger` | `"arrival"` \| `"proximity"` | One-shot instead of a loop. `"arrival"` fires on reaching a beacon; `"proximity"` fires on entering `proximity` of the anchor. |
| `pool` | string[] | Random-clip player: picks one of these each interval (used for e.g. a companion's voice lines). |
| `every` | `[min, max]` | Seconds between `pool` plays (default `[15, 20]`). |

> **Gotcha: `stages` is 0-based, but stage `id` is 1-based.** `stages: [0, 2]` means
> the first and third entries in `quest[]`, i.e. stages with `id` 1 and 3 (assuming
> sequential ids). Off-by-one here is the most common authoring bug.

To add a sound, drop a file in `public/audio/` and add a cue. No code change is
needed. `window.__sounds()` (dev) dumps each cue's live
`{loaded, playing, gain, positional}`.
