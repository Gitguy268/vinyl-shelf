// npm run e2e: makes the music fixtures (needs ffmpeg) and runs the folder and picker tests against dist/.
// Locally, when tests/protocol/site.sh has built the player copies, playback is tested too.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
execFileSync(
  'bash',
  [path.join(root, 'tests/e2e/fixtures.sh'), path.join(root, '.scratch/music')],
  { stdio: 'inherit' },
);
execFileSync(
  process.execPath,
  [
    path.join(root, 'tests/e2e/folder.mjs'),
    process.env.ENGINES ?? 'chromium,firefox,webkit',
    'http,file',
  ],
  {
    stdio: 'inherit',
  },
);
execFileSync(process.execPath, [path.join(root, 'tests/e2e/pickers.mjs')], { stdio: 'inherit' });
