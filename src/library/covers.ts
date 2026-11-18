import { coverColours } from '../art/colour';
import { canvas, ctx2d, drawCover, toBlob } from '../art/draw';
import { generatedCover } from '../art/generate';
import type { CoverRecord } from './store';
import type { Album } from './types';

export const THUMB = 512;

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** A square thumbnail and its spine colours, from any image. */
export async function coverFromImage(
  img: CanvasImageSource & { width: number; height: number },
  source: CoverRecord['source'],
): Promise<CoverRecord> {
  const c = canvas(THUMB, THUMB);
  const g = ctx2d(c);
  drawCover(g, img, 0, 0, THUMB);
  const small = canvas(32, 32);
  const sg = ctx2d(small);
  sg.drawImage(c, 0, 0, 32, 32);
  const { colour, ink } = coverColours(sg.getImageData(0, 0, 32, 32).data);
  return { blob: await toBlob(c), colour, ink, source };
}

export async function coverFromBlob(
  blob: Blob,
  source: CoverRecord['source'],
): Promise<CoverRecord | null> {
  const bitmap = await decode(blob);
  if (!bitmap) return null;
  try {
    return await coverFromImage(bitmap, source);
  } finally {
    bitmap.close();
  }
}

export function madeCover(album: Album): Promise<CoverRecord> {
  return coverFromImage(generatedCover(album, THUMB), 'made');
}
