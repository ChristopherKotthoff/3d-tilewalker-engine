# Architecture & gotchas

How the engine actually works. Read this before touching the 3D world, the
coordinate math, or the teleport logic. Several of these behaviours are invisible to
`tsc` and only surface at runtime.

## Data flow

```
public/game.json ──fetch──► Zustand store (store.ts) ◄──reads/writes──┐
   (the game)                   │  stageIndex, phase                  │
                                ▼                                     │
App.tsx ── Canvas ──► World.tsx (memoized) ── TilesRenderer + plugins │
                        └─ WorldLogic (useFrame loop):                │
                             • raycast-snap to ground (+ rescue)      │
                             • movement + gait, car, companion follow │
                             • follow camera + mouse-look orbit       │
                             • place glow, test arrival radius ───────┘ writes phase
                             • teleport re-centering + cache prune
                             • sound gating/fading
                        └─ portal(scene): Sky, Character, Companion,
                                          Car, Glow, Sound, shadow lights
UI.tsx ── subscribes to store ──► clue note, letters, fade veil, attribution
```

The golden rule: the 3D world *writes* game state inside `useFrame`; the React UI
*reads* it and renders DOM. They never touch each other directly. They meet only
through the Zustand store.

## The phase machine (`store.ts`)

```
loading → intro → playing → (minigame) → reading → (teleporting) → ended
```

- **`playing`**: walking around; movement and the arrival trigger are active.
- **`minigame`**: an orb with a registered minigame was reached. A modal hosts the
  game while movement and game audio are cut. On win or skip the stage's normal
  outcome runs.
- **`reading`**: a beacon was entered. The arrival letter is open and movement is
  frozen.
- **`teleporting`**: fade-to-black while the world re-centers at the destination. It
  is held until the destination ground has genuinely *settled*, then moves to
  `reading`.
- **`ended`**: final stage cleared.

Stage is persisted to `localStorage` (`cw:stage`), so a reload resumes at the same
stage. `arrive()` checks for a registered minigame (going to `minigame` if there is
one), then `applyArrival()` decides between teleport, letter, or straight-to-next
based on the stage's `action`.

## Coordinate system (read before touching positions)

Google tiles arrive in **ECEF**, with values around 6.4 million metres that cause
float32 jitter. The `ReorientationPlugin` re-centers so the active lat/lon sits at
the world origin `(0,0,0)` with +Y up. That has a few consequences:

- The player and every teleport destination are just `(0,0,0)` after re-centering,
  so do **not** run them through `latLngToWorld`.
- Glows (and any other lat/lng-anchored object) *are* offsets from that origin, so
  use `latLngToWorld()` in [`geo.ts`](../src/geo.ts), which applies
  `tiles.group.matrixWorld`.
- The plugin and the ellipsoid take radians, so always use `MathUtils.degToRad(...)`.
- Teleport is `transformLatLonHeightToOrigin(latRad, lonRad, 0)`, then reset the
  player to the origin.

## Critical gotchas

These cost real debugging time. Don't re-break them.

1. **No `<React.StrictMode>`.** Its dev-only double-invoke re-registers the tiles
   plugins, whose init/dispose isn't idempotent. It throws and freezes the frame
   loop. It's kept out of `main.tsx` deliberately.

2. **The tiles subtree must render exactly once.** `<TilesPlugin>` disposes and
   re-registers its plugin when its `args` change by identity, and mid-stream that
   corrupts the `TilesRenderer`. So `World` is `React.memo`'d (it takes no props),
   plugin `args` arrays are `useMemo`'d, and no game-state-dependent props go on
   `<TilesRenderer>` or `<TilesPlugin>`.

3. **Portal your own objects to the scene root.** `<TilesRenderer>` wraps its
   children in a group carrying the ~6.3 M-metre ECEF recenter matrix. Objects
   authored in recentered space get that offset applied twice and render off-world
   or invisible. Sky, Character, Companion, Car, Glow, and lights are
   `createPortal(..., scene)`'d. Relative distances still look right if you forget,
   so it reads like a positioning bug rather than a parenting one.

4. **`useFrame` can hold a stale render closure.** Read mutable game state with
   `useGame.getState()` inside the frame loop, not from the render-scope closure,
   for anything that changes during play such as `stageIndex`.

5. **The ground ray can miss even when the city is "loaded".** The tile under a
   stationary player is often a coarse-LOD hole, and a far teleport frequently
   refines geometry about 1 km from the origin while `loadProgress` already reads
   100%. Grounding defends in layers: it sweeps from 10 000 m, spiral-probes rings if
   the centre misses, and after a grace period relocates onto the nearest loaded
   tile. Don't simplify this back to a single down-ray.

6. **The teleport re-center runs in the frame loop, not a React effect.** It's keyed
   on a monotonic `teleportSeq` compared to a `handledSeq` ref, applied before the
   ground-lock that finishes the teleport. An effect raced with same-city warps: the
   destination tiles were already loaded, so the phase flipped back to `playing`
   before React flushed the effect, and the recenter was skipped. Bump `teleportSeq`
   in every warp entry point.

7. **Post-teleport, keep the player at the origin and hold the veil until the ground
   settles.** After a recenter the destination *is* `(0,0,0)`, so the ground rescue
   must not relocate the player onto a distant coarse tile's centre. The veil lifts
   only once real origin geometry exists and its surface has stopped rising, with
   force-lock and failsafe timers so a warp can never hang.

8. **Audio needs a user gesture, and `PositionalAudio.type` is `"Audio"`.** Browsers
   keep the `AudioContext` suspended until a real gesture, so `Sound.tsx` resumes it
   on the first `pointerdown`/`keydown`. Three's `PositionalAudio` extends `Audio`
   without overriding `.type`, so detect positional nodes by `.panner`, not by
   `.type`.

## Debugging over CDP

The bugs above are invisible to `tsc` and `curl`, so validate in a real browser. In
dev, internals are exposed on `window`:

- `window.__game` is the Zustand store. Try `__game.getState().phase` or
  `__game.getState().devTeleport({lat, lng})`.
- `window.__player`, `window.__glow`, `window.__tiles` are live scene objects. Snap
  onto a beacon with `__player.position.x = __glow.x; __player.position.z = __glow.z`.
- `window.__animState()` returns the player's current animation state.
- `window.__sounds()` returns each cue's `{loaded, playing, gain, positional}`.
- `window.__minigames()` lists the registered minigame ids.
- `window.__debugSnapshot()` returns full scene state; `window.__raytest()` casts a
  down-ray at the player for diagnosing ground misses.

To drive headless Chrome you need software WebGL, since headless can't make a real
GL context otherwise:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mw about:blank
```

Then open a tab (`PUT /json/new?<url>`), connect the returned `webSocketDebuggerUrl`,
and `Runtime.evaluate` expressions against the hooks above.

## File map

| File | Role |
|---|---|
| `public/game.json` | The entire game content. See [game-json.md](game-json.md). |
| `src/App.tsx` | Fetches `game.json`, sets up the `<Canvas>`, mounts `<World>`. |
| `src/World.tsx` | The heart: tiles setup plus the `WorldLogic` frame loop. |
| `src/store.ts` | Zustand store and phase machine. |
| `src/types.ts` | `GameConfig` / `Stage` / `LatLng` / `SoundCue` types. |
| `src/geo.ts` | `latLngToWorld()` / `worldToLatLng()`. |
| `src/Character.tsx` | Player avatar (`/player.glb`) plus animation state machine. |
| `src/Companion.tsx` | Companion avatar (`/chris.glb`) plus idle-clip pool. |
| `src/Car.tsx` / `src/Vehicle.tsx` | Drivable car / boardable teleport vehicles. |
| `src/Glow.tsx` | The beacon marker. |
| `src/Sound.tsx` | JSON-driven soundscape manager. |
| `src/UI.tsx` | All DOM overlay: clue note, letters, fade veil, attribution. |
| `src/Minimap.tsx` | GTA-style radar with a Google 2D-tile underlay and walking route. |
| `src/Debug.tsx` | Dev-only debug panel (`P`). |
| `src/minigames/` | The minigame engine. See [minigames.md](minigames.md). |
