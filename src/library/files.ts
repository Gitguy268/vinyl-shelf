/** What counts as music and as a cover in a folder. */

const AUDIO = new Set([
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'flac',
  'wav',
  'wave',
  'ogg',
  'oga',
  'opus',
  'weba',
  'webm',
  'aif',
  'aiff',
  'alac',
  'wma',
]);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

export function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Hidden files, macOS AppleDouble `._` files and anything under a dot folder are skipped. */
export function isHidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'));
}

export function isAudioPath(path: string): boolean {
  return !isHidden(path) && AUDIO.has(extension(path));
}

export function isImagePath(path: string): boolean {
  return !isHidden(path) && IMAGE.has(extension(path));
}

/** Cover file names, best first. A name that is none of these is still used if it is the only image. */
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'artwork', 'albumartlarge'];

/** Picks the cover among the images in an album's folder (or a scans/artwork subfolder). */
export function pickCover(
  folder: string,
  images: readonly { path: string; size: number }[],
): string | null {
  const near = images.filter((img) => {
    const dir = dirName(img.path);
    if (dir === folder) return true;
    const sub = dir.startsWith(folder + '/') ? dir.slice(folder.length + 1).toLowerCase() : '';
    return (
      sub !== '' &&
      !sub.includes('/') &&
      /^(scans?|artwork|covers?|images?|(cd|dis[ck])\s*0*1)$/.test(sub)
    );
  });
  if (near.length === 0) return null;
  const rank = (path: string): number => {
    const stem = baseName(path)
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[\s_-]+/g, '');
    return COVER_NAMES.findIndex((name) => stem === name || stem.startsWith(name));
  };
  const inFolder = (path: string): boolean => dirName(path) === folder;
  const named = near.filter((img) => rank(img.path) >= 0);
  if (named.length > 0) {
    const key = (path: string): number => rank(path) + (inFolder(path) ? 0 : 100);
    return [...named].sort((a, b) => key(a.path) - key(b.path) || b.size - a.size)[0]!.path;
  }
  // No cover by name: the largest image right in the folder (often "Album Title.jpg").
  const loose = near.filter((img) => inFolder(img.path));
  return loose.length > 0 ? [...loose].sort((a, b) => b.size - a.size)[0]!.path : null;
}
