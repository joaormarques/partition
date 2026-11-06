# Partition

A browser arcade game about splitting a board around bouncing balls. Build walls to seal off empty areas; a ball that touches a wall while it is still growing breaks it and costs a life. Fill 75% of the board to clear a level.

It is an original game in the wall-building genre, with its own ball types, power-ups, art and audio. Everything is drawn on a canvas and every sound is synthesized with Web Audio, so there are no image or audio files.

## Play

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. In dev builds, `?level=5` starts on level 5 (useful for trying later ball kinds), and the game is exposed as `window.game` in the console.

### Controls

| Action | Mouse / keyboard | Touch |
|---|---|---|
| Build a wall | Click an empty cell | Tap |
| Rotate | Right-click, Space or the ↕ button | Swipe in the direction you want, or the ↕ button |
| Pause | P or Esc | Open Settings |
| Mute | M or the speaker button | Speaker button |

Settings (the gear button) has difficulty, audio and best scores.

### Ball kinds

Basic (level 1), Heavy (2, falls with gravity), Glass (3, shatters after 6 bounces into short-lived shards), Splitter (4, splits in two when it breaks a wall) and Phantom (5, drifts through filled areas). Balls you don't destroy carry over to the next level.

### Power-ups

Seal one into a filled area to collect it: Magnet (next wall repels balls), Bomb (next click destroys nearby balls), Multiplier (×2, then ×3 points), Fast walls and Freeze.

### Difficulty

| | Ball speed | Lives | Clear at |
|---|---|---|---|
| Relaxed | 80% | level + 3 | 70% |
| Normal | 100% | level + 1 | 75% |
| Hard | 120% | level (min 1) | 80% |

Difficulty changes apply from the next game. Best scores are kept per difficulty in the browser's local storage; the game still works if storage is blocked.

## Develop

```bash
npm test
```

```bash
npm run typecheck
```

```
src/
  game/      rules only, no DOM: grid, balls, walls, power-ups, levels, difficulty (unit-tested)
  render/    canvas drawing: cached board layers, particles, sprites, overlays, theme
  audio/     Web Audio engine and the generated music pattern
  ui/        settings dialog
  storage.ts guarded localStorage, high scores
  main.ts    input, HUD, game loop (fixed 120 Hz simulation)
```

Most tuning lives in constants: `src/game/constants.ts` (board, speeds), the `KINDS` table in `src/game/Ball.ts`, `src/game/PowerUps.ts`, `src/game/difficulty.ts`, and sound volumes in `src/audio/AudioEngine.ts`.

## Build and deploy

```bash
npm run build
```

`dist/` is a static site with relative paths, so it can be served from any folder: GitHub Pages, Netlify, or any static host. Preview it locally with `npx vite preview`.

```bash
npm run build:artifact
```

Also writes `dist/partition.html`, the same page without its outer document tags, for publishing as a claude.ai Artifact together with the files in `dist/assets/`.
