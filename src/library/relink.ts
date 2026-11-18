/**
 * Matching a freshly picked folder to the index. Browsers without the File System Access API
 * (Brave, Firefox, Safari) hand over a new set of File objects every session; a file whose path,
 * size and time are unchanged keeps its tags, so a big library is back without reading a tag.
 */

export interface Known {
  path: string;
  size: number;
  mtime: number;
}

export interface Picked<F> {
  path: string;
  size: number;
  mtime: number;
  file: F;
}

export interface Relink<F> {
  /** Unchanged files: the indexed path, and the file as picked (its path is the new one). */
  matched: { known: string; picked: Picked<F> }[];
  /** Files to read tags from: new, or changed since they were indexed. */
  fresh: Picked<F>[];
  /** Indexed paths not in the folder any more. */
  missing: string[];
  /** Leading folders the picked paths have more (positive) or fewer (negative) than the index. */
  shift: number;
}

function toKnown(path: string, shift: number, prefix: readonly string[]): string | null {
  if (shift === 0) return path;
  if (shift > 0) {
    const parts = path.split('/');
    return parts.length > shift ? parts.slice(shift).join('/') : null;
  }
  return [...prefix, path].join('/');
}

/**
 * Picking `Music` where `Music/Jazz` was indexed (or the other way round) shifts every path by a
 * folder: the shift that matches the most files wins. The picked folder's paths are kept; the
 * index follows them.
 */
export function relink<F>(known: readonly Known[], picked: readonly Picked<F>[]): Relink<F> {
  const byPath = new Map(known.map((k) => [k.path, k]));
  const sample = picked.slice(0, 400);
  const candidates: { shift: number; prefix: string[] }[] = [0, 1, 2, 3].map((shift) => ({
    shift,
    prefix: [],
  }));
  const leads = new Set<string>();
  for (const k of known.slice(0, 400)) {
    const parts = k.path.split('/');
    for (let n = 1; n <= Math.min(2, parts.length - 1); n++) leads.add(parts.slice(0, n).join('/'));
  }
  for (const lead of leads)
    candidates.push({ shift: -lead.split('/').length, prefix: lead.split('/') });
  let best = { shift: 0, prefix: [] as string[], hits: 0 };
  for (const c of candidates) {
    let hits = 0;
    for (const p of sample) {
      const path = toKnown(p.path, c.shift, c.prefix);
      if (path !== null && byPath.has(path)) hits++;
    }
    if (hits > best.hits) best = { ...c, hits };
  }
  const matched: Relink<F>['matched'] = [];
  const fresh: Picked<F>[] = [];
  const seen = new Set<string>();
  for (const p of picked) {
    const path = toKnown(p.path, best.shift, best.prefix);
    const k = path === null ? undefined : byPath.get(path);
    if (k) seen.add(k.path);
    if (k && k.size === p.size && Math.abs(k.mtime - p.mtime) < 2000)
      matched.push({ known: k.path, picked: p });
    else fresh.push(p);
  }
  const missing = known.map((k) => k.path).filter((path) => !seen.has(path));
  return { matched, fresh, missing, shift: best.shift };
}
