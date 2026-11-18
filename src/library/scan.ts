import { isAudioPath, isHidden, isImagePath } from './files';

/** A file found in the music folder, with its path inside that folder. */
export interface Found {
  path: string;
  file: File;
}

export interface FolderContents {
  /** The folder's own name, as the browser reports it. */
  name: string;
  audio: Found[];
  images: Found[];
}

type Progress = (count: number) => void;

function sortInto(out: FolderContents, path: string, file: File): void {
  if (isAudioPath(path)) out.audio.push({ path, file });
  else if (isImagePath(path)) out.images.push({ path, file });
}

/** Chromium's File System Access API: the handle can be kept and opened again next visit. */
export async function readDirectoryHandle(
  root: FileSystemDirectoryHandle,
  onProgress?: Progress,
): Promise<FolderContents> {
  const out: FolderContents = { name: root.name, audio: [], images: [] };
  let seen = 0;
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const files: Promise<void>[] = [];
    const dirs: [FileSystemDirectoryHandle, string][] = [];
    // `entries()` is in every engine that has the API; the DOM typings lag behind.
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (isHidden(path)) continue;
      if (handle.kind === 'directory') dirs.push([handle as FileSystemDirectoryHandle, path]);
      else if (isAudioPath(path) || isImagePath(path))
        files.push(
          (handle as FileSystemFileHandle).getFile().then(
            (file) => {
              sortInto(out, path, file);
              if (++seen % 50 === 0) onProgress?.(seen);
            },
            () => undefined,
          ),
        );
    }
    await Promise.all(files);
    for (const [sub, path] of dirs) await walk(sub, path);
  };
  await walk(root, '');
  onProgress?.(seen);
  return out;
}

/** `<input type=file webkitdirectory>`: every engine; paths start with the folder's own name. */
export function readFileList(list: FileList | readonly File[]): FolderContents {
  const files = [...list];
  const first = files[0]?.webkitRelativePath ?? '';
  const name = first.includes('/') ? first.slice(0, first.indexOf('/')) : '';
  const out: FolderContents = { name, audio: [], images: [] };
  for (const file of files) {
    const rel = file.webkitRelativePath || file.name;
    const path = name && rel.startsWith(name + '/') ? rel.slice(name.length + 1) : rel;
    sortInto(out, path, file);
  }
  return out;
}

/** A folder (or files) dropped on the page. One dropped folder is the root, like a picked one. */
export async function readDrop(
  items: DataTransferItemList,
  onProgress?: Progress,
): Promise<FolderContents> {
  const entries = [...items]
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((e): e is FileSystemEntry => e !== null);
  const single = entries.length === 1 && entries[0]!.isDirectory ? entries[0]! : null;
  const out: FolderContents = { name: single?.name ?? '', audio: [], images: [] };
  let seen = 0;
  const fileOf = (entry: FileSystemFileEntry): Promise<File | null> =>
    new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  const children = (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
    new Promise((resolve) => {
      const reader = dir.createReader();
      const all: FileSystemEntry[] = [];
      // readEntries returns at most 100 at a time in Chromium: read until it returns none.
      const next = (): void =>
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) resolve(all);
            else {
              all.push(...batch);
              next();
            }
          },
          () => resolve(all),
        );
      next();
    });
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (isHidden(path)) return;
    if (entry.isDirectory) {
      for (const child of await children(entry as FileSystemDirectoryEntry))
        await walk(child, path ? `${path}/${child.name}` : child.name);
    } else if (isAudioPath(path) || isImagePath(path)) {
      const file = await fileOf(entry as FileSystemFileEntry);
      if (file) sortInto(out, path, file);
      if (++seen % 50 === 0) onProgress?.(seen);
    }
  };
  if (single) {
    for (const child of await children(single as FileSystemDirectoryEntry))
      await walk(child, child.name);
  } else {
    for (const entry of entries) await walk(entry, entry.name);
  }
  onProgress?.(seen);
  return out;
}
