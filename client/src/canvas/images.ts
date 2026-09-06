import * as fabric from 'fabric';
import { api } from '../lib/api';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
/** The longest edge a placed image is scaled down to. */
export const MAX_IMAGE_EDGE = 480;

/** What the file picker offers, and what a paste or a drop is filtered by. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

export const isSupportedImage = (file: File) => ACCEPTED_IMAGE_TYPES.includes(file.type);

/**
 * The first supported image in a paste or a drop.
 *
 * `files` and `items` are checked in that order because they disagree: a
 * dragged file shows up in `files`, while a screenshot pasted from the system
 * clipboard is an `item` of kind `file` and may not appear in `files` at all.
 */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files || [])) {
    if (isSupportedImage(file)) return file;
  }
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isSupportedImage(file)) return file;
  }
  return null;
}

/** Whether a drag carries files at all — the only thing readable on dragover. */
export const transferHasFiles = (data: DataTransfer | null) =>
  Array.from(data?.types || []).includes('Files');

const apiOrigin = () =>
  new URL(api.defaults.baseURL || window.location.origin, window.location.origin).origin;

/**
 * Uploads and returns the absolute URL to place on the canvas.
 *
 * The response carries an absolute `url` as well, but the server builds it from
 * the request's `Host` header. We already know which API we are talking to, so
 * the relative `path` is resolved here instead; `url` is only the fallback for
 * a server that predates it.
 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const { data } = await api.post('/uploads/image', form);
  return data.path ? new URL(data.path, apiOrigin()).href : data.url;
}

/**
 * `crossOrigin: 'anonymous'` is not decoration. Uploads are served from the API
 * origin, which is never the client's, and drawing a cross-origin image without
 * CORS *taints* the canvas: every `toDataURL` after it throws a SecurityError.
 * That is PNG, JPEG and PDF export plus the dashboard thumbnail, gone for good
 * on any board that ever held one image.
 *
 * Fabric serializes `crossOrigin` alongside `src` and passes it back to
 * `loadImage` on the way in, so it survives the round trip to other clients.
 */
export async function createImage(
  url: string,
  at: { x: number; y: number }
): Promise<fabric.FabricImage> {
  const image = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
  const width = image.width || 1;
  const height = image.height || 1;
  // Never upscale: a 32px icon should arrive 32px, not blown up to 480.
  const scale = Math.min(MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height, 1);
  image.set({
    left: at.x - (width * scale) / 2,
    top: at.y - (height * scale) / 2,
    scaleX: scale,
    scaleY: scale,
  });
  image.setCoords();
  return image;
}

/** The centre of what the viewer is currently looking at, in scene coordinates. */
export function viewportCentre(canvas: fabric.Canvas): fabric.Point {
  return fabric.util.transformPoint(
    new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2),
    fabric.util.invertTransform(canvas.viewportTransform)
  );
}
