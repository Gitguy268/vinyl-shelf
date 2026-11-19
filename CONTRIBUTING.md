# Contributing

Thanks for wanting to help. Vinyl Shelf is a small project; issues and pull requests are welcome.

## Run it

```sh
git clone https://github.com/Gitguy268/vinyl-shelf.git
cd vinyl-shelf
npm ci
npm run dev        # http://localhost:5291 — add ?demo for the demo shelf, ?debug for window.__shelf
```

`npm start` builds the single `dist/index.html` and opens it from `vite preview` (port 4291).

## Checks

| Command                                  | What it does                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                         | lint, format check, typecheck, unit tests, build                                                                                   |
| `npm run e2e`                            | makes a music folder with ffmpeg (`tests/e2e/fixtures.sh`) and imports it in Chromium, Firefox and WebKit, over http and `file://` |
| `node scripts/notice.mjs`                | rewrites NOTICE from the packages the build bundles (`--check` in CI)                                                              |
| `node tests/protocol/gate0.mjs <player>` | a player page receives an album from three kinds of parent page (needs `bash tests/protocol/site.sh`)                              |
| `node tests/protocol/storage.mjs`        | a player's saved library is byte-identical after a hand-off                                                                        |

## Layout

- `src/library/` — reading the folder, tags, grouping into albums, re-linking, the IndexedDB index, covers, the demo shelf.
- `src/art/` — everything drawn on a canvas: made covers, spines, back covers, labels.
- `src/scene/` — the 3D room: layout (pure, tested), sleeves (instanced, with a spine atlas), the record in your hands, the turntable, the camera.
- `src/ui/` — the page around the canvas: panels, the deck, the hand-off client, the list view.
- `docs/PROTOCOL.md` — the vinyl-shelf/1 hand-off. A player change that needs the protocol to change bumps `v`.

## Rules

- Never commit music, covers or file names from a real library. Fixtures are made by ffmpeg; screenshots use the demo shelf.
- Pin dependencies exactly and run `node scripts/notice.mjs` after adding one.
- Keep everything in the one `index.html`: no fetches at run time, no CDN.
- Small, focused commits. Update CHANGELOG under Unreleased.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
