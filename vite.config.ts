/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * One self-contained index.html: the same file is the Pages site and the page you double-click.
 * Scripts, styles and fonts are inlined, so it runs from file:// with nothing beside it.
 */

/** three.js keeps URL comments inside GLSL strings and logs through console.log; neither belongs in the page. */
function scrubThree(): Plugin {
  return {
    name: 'scrub-three',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/node_modules/three/')) return null;
      return code
        .replace(/^[ \t]*\/\/[ \t]*https?:\/\/\S+[ \t]*$/gm, '')
        .replace(/console\.log\(/g, 'console.warn(');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [scrubThree(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    modulePreload: { polyfill: false },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
