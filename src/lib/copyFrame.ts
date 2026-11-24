// Copy one frame to the clipboard as an image, looking the way the
// Player shows it: edits, cursor, click rings, key labels and spotlight
// included.

import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

import { FrameThumb } from "./tauri";
import { FrameLayers, loadEditImages, loadFrameBitmap, paintFrame } from "./renderFrame";

export async function copyFrameToClipboard(
  thumb: FrameThumb,
  layers: Omit<FrameLayers, "imageCache">,
): Promise<void> {
  const bitmap = await loadFrameBitmap(thumb);
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not draw the frame to copy it.");
    const imageCache = await loadEditImages([thumb], layers.edits);
    paintFrame(ctx as unknown as CanvasRenderingContext2D, bitmap, thumb, width, height, {
      ...layers,
      imageCache,
    });

    // The browser clipboard takes a PNG directly. If the webview refuses
    // (no focus, or the API is unavailable), hand the pixels to the
    // system clipboard through Tauri instead.
    try {
      const png = await canvas.convertToBlob({ type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch {
      const pixels = ctx.getImageData(0, 0, width, height);
      const image = await TauriImage.new(new Uint8Array(pixels.data.buffer), width, height);
      await writeImage(image);
    }
  } finally {
    bitmap.close();
  }
}
