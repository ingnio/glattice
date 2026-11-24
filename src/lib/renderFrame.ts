// One place that turns a source frame into what the Player shows: the
// frame itself, its edits, then the cursor, click rings, key labels and
// spotlight. Every export goes through here so a saved file can never
// drift from the preview.

import { convertFileSrc, FrameThumb, InputEvent } from "./tauri";
import { FrameEdits, getFrameEdits } from "./edits";
import { SpotlightDraft } from "./prefs";
import {
  drawClicks,
  drawCursor,
  drawKeys,
  drawSpotlight,
  paintEdit,
} from "./paintEdits";

/** Everything that gets drawn on top of a source frame. */
export interface FrameLayers {
  edits: FrameEdits;
  inputEvents: InputEvent[];
  spotlight?: SpotlightDraft | null;
  /** Decoded images for any "image" edits, keyed by their src. */
  imageCache: Map<string, HTMLImageElement>;
}

/** Paint one frame, with all of its layers, at `width` × `height`. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  thumb: FrameThumb,
  width: number,
  height: number,
  layers: FrameLayers,
): void {
  ctx.drawImage(image, 0, 0, width, height);

  for (const e of getFrameEdits(layers.edits, thumb.index)) {
    paintEdit(ctx, image, e, { imageCache: layers.imageCache });
  }
  if (thumb.cursor) drawCursor(ctx, thumb.cursor.x, thumb.cursor.y);
  if (layers.inputEvents.length > 0) {
    drawClicks(ctx, layers.inputEvents, thumb.elapsedMs, width, height);
    drawKeys(ctx, layers.inputEvents, thumb.elapsedMs, width, height);
  }
  if (layers.spotlight?.enabled && thumb.cursor) {
    drawSpotlight(
      ctx,
      thumb.cursor.x,
      thumb.cursor.y,
      layers.spotlight.radius,
      layers.spotlight.dimOpacity,
    );
  }
}

/** Decode a frame's full-resolution PNG. */
export async function loadFrameBitmap(thumb: FrameThumb): Promise<ImageBitmap> {
  const res = await fetch(convertFileSrc(thumb.path));
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

/** Pre-load the images used by "image" edits on the given frames so
 *  `paintFrame` can draw them synchronously. Images that fail to load
 *  are skipped rather than failing the export. */
export async function loadEditImages(
  thumbs: FrameThumb[],
  edits: FrameEdits,
): Promise<Map<string, HTMLImageElement>> {
  const cache = new Map<string, HTMLImageElement>();
  const srcs = new Set<string>();
  for (const t of thumbs) {
    for (const e of getFrameEdits(edits, t.index)) {
      if (e.kind === "image") srcs.add(e.src);
    }
  }
  await Promise.all(
    [...srcs].map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            cache.set(src, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
  return cache;
}
