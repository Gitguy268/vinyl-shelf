/** Addresses for vinyl-shelf/1, kept free of the DOM so they can be tested. */

/** `?shelf` added to a player address, keeping its own query and hash. */
export function shelfUrl(url: string, base: string): string {
  const u = new URL(url, base);
  u.searchParams.set('shelf', '');
  return u.href;
}

/** The origin to post to: the player's own, or '*' for a file: page (its origin is opaque). */
export function originOf(url: string, base: string): string {
  const u = new URL(url, base);
  return u.protocol === 'file:' ? '*' : u.origin;
}
