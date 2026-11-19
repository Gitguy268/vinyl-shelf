import { describe, expect, it } from 'vitest';
import { originOf, shelfUrl } from '../../src/ui/protocol';

const BASE = 'https://gitguy268.github.io/vinyl-shelf/';

describe('hand-off addresses', () => {
  it("posts to the player's own origin, and only to '*' for a file: page", () => {
    expect(originOf('https://gitguy268.github.io/realistic-vinyl-player/', BASE)).toBe(
      'https://gitguy268.github.io',
    );
    expect(originOf('http://localhost:8080/index.html?x=1', BASE)).toBe('http://localhost:8080');
    expect(originOf('file:///Users/me/player/index.html', BASE)).toBe('*');
  });

  it('adds ?shelf and keeps the rest of the address', () => {
    expect(shelfUrl('https://gitguy268.github.io/8bit-player/vinyl-8bit.html', BASE)).toBe(
      'https://gitguy268.github.io/8bit-player/vinyl-8bit.html?shelf=',
    );
    expect(shelfUrl('http://localhost:8080/?theme=dark#top', BASE)).toBe(
      'http://localhost:8080/?theme=dark&shelf=#top',
    );
  });
});
