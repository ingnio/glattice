// Encode the clip as an animated GIF in the browser, from the same
// composited frames the Player shows (see renderFrame.ts). This is what
// makes an exported GIF carry the edits, trim, frame order, holds and
// overlays; copying the capture file would leave all of that out.
//
// The encoder is small and self-contained:
//   - each frame gets its own palette (median cut over an RGB565
//     histogram), so flat UI colours stay exact;
//   - frames after the first only store the pixels that changed, as a
//     cropped rectangle with the rest transparent, which keeps screen
//     recordings compact;
//   - consecutive identical frames are folded into one longer delay.

import { FrameThumb, InputEvent } from "./tauri";
import { FrameEdits } from "./edits";
import { SpotlightDraft } from "./prefs";
import { loadEditImages, loadFrameBitmap, paintFrame } from "./renderFrame";
import { applyTrim, TrimRange } from "./trim";

export interface GifEncodeOptions {
  /** Frames in display order (already reordered / without deleted ones). */
  thumbs: FrameThumb[];
  trim: TrimRange | null;
  edits: FrameEdits;
  inputEvents: InputEvent[];
  fps: number;
  /** Extra hold time in ms per original frame index. */
  frameDelays?: Record<number, number>;
  spotlight?: SpotlightDraft | null;
  onProgress?: (done: number, total: number) => void;
}

// ——— output buffer ————————————————————————————————————————————————

class ByteSink {
  private buf = new Uint8Array(1 << 20);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  byte(v: number): void {
    this.ensure(1);
    this.buf[this.length++] = v;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.length++] = v & 0xff;
    this.buf[this.length++] = (v >> 8) & 0xff;
  }

  bytes(src: ArrayLike<number>): void {
    this.ensure(src.length);
    this.buf.set(src, this.length);
    this.length += src.length;
  }

  /** Overwrite a little-endian u16 written earlier. */
  setU16(offset: number, v: number): void {
    this.buf[offset] = v & 0xff;
    this.buf[offset + 1] = (v >> 8) & 0xff;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

// ——— LZW ———————————————————————————————————————————————————————————
//
// Variable-width LZW as GIF specifies it: codes start one bit wider
// than the palette index, grow as the string table fills, and the
// table is reset with a clear code once it holds 4096 entries. The
// string table is an open-addressed hash keyed by (prefix, next byte).

const HASH_SIZE = 5003;
const MAX_CODES = 4096;
const hashKeys = new Int32Array(HASH_SIZE);
const hashCodes = new Uint16Array(HASH_SIZE);
const lzwBlock = new Uint8Array(255);

function lzwEncode(pixels: Uint8Array, minCodeSize: number, out: ByteSink): void {
  out.byte(minCodeSize);

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  hashKeys.fill(-1);

  // Codes are packed least-significant-bit first into data sub-blocks
  // of at most 255 bytes.
  let blockLen = 0;
  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code: number): void => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      lzwBlock[blockLen++] = bitBuf & 0xff;
      if (blockLen === 255) {
        out.byte(255);
        out.bytes(lzwBlock);
        blockLen = 0;
      }
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  // After a data code the decoder may have grown its table past what
  // the current width can address; widen in step with it.
  const emitData = (code: number): void => {
    emit(code);
    if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
  };

  emit(clearCode);

  let prefix = pixels[0];
  const n = pixels.length;
  for (let i = 1; i < n; i++) {
    const k = pixels[i];
    const key = (k << 12) | prefix;
    let h = (k << 4) ^ prefix; // < 4096, so always inside the table

    let stored = hashKeys[h];
    if (stored === key) {
      prefix = hashCodes[h];
      continue;
    }
    if (stored !== -1) {
      // Secondary probe, stepping by a displacement derived from the slot.
      const disp = h === 0 ? 1 : HASH_SIZE - h;
      let found = false;
      for (;;) {
        h -= disp;
        if (h < 0) h += HASH_SIZE;
        stored = hashKeys[h];
        if (stored === key) {
          prefix = hashCodes[h];
          found = true;
          break;
        }
        if (stored === -1) break;
      }
      if (found) continue;
    }

    // (prefix + k) is new: emit the prefix, remember the new string.
    emitData(prefix);
    if (nextCode < MAX_CODES) {
      hashKeys[h] = key;
      hashCodes[h] = nextCode++;
    } else {
      emit(clearCode);
      hashKeys.fill(-1);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }

  emitData(prefix);
  emit(eoiCode);

  if (bitCount > 0) {
    lzwBlock[blockLen++] = bitBuf & 0xff;
    if (blockLen === 255) {
      out.byte(255);
      out.bytes(lzwBlock);
      blockLen = 0;
    }
  }
  if (blockLen > 0) {
    out.byte(blockLen);
    out.bytes(lzwBlock.subarray(0, blockLen));
  }
  out.byte(0); // block terminator
}

// ——— palette (median cut) ——————————————————————————————————————————
//
// Pixels are binned to RGB565. Bins are split into boxes along their
// longest axis at the pixel-count median until there is one box per
// palette slot; each box's colour is the true average of its pixels,
// and every bin remembers which box (palette index) it ended up in.

const BINS = 1 << 16;
const binCount = new Uint32Array(BINS);
const binR = new Float64Array(BINS);
const binG = new Float64Array(BINS);
const binB = new Float64Array(BINS);
const binOrder = new Uint32Array(BINS);
const binToIndex = new Uint8Array(BINS);

function resetHistogram(): void {
  binCount.fill(0);
  binR.fill(0);
  binG.fill(0);
  binB.fill(0);
}

/** Add one pixel (little-endian RGBA packed in a u32) to the histogram. */
function addPixel(v: number): void {
  const bin = ((v & 0xf8) << 8) | ((v >> 5) & 0x7e0) | ((v >> 19) & 0x1f);
  binCount[bin]++;
  binR[bin] += v & 0xff;
  binG[bin] += (v >> 8) & 0xff;
  binB[bin] += (v >> 16) & 0xff;
}

function binOf(v: number): number {
  return ((v & 0xf8) << 8) | ((v >> 5) & 0x7e0) | ((v >> 19) & 0x1f);
}

interface Box {
  start: number;
  end: number;
  count: number;
  /** 0 = red, 1 = green, 2 = blue: the axis with the widest spread. */
  axis: number;
  /** Split priority; <= 0 means the box can't be split any further. */
  score: number;
}

function measureBox(start: number, end: number): Box {
  let rMin = 31, rMax = 0, gMin = 63, gMax = 0, bMin = 31, bMax = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const bin = binOrder[i];
    const r = bin >> 11;
    const g = (bin >> 5) & 63;
    const b = bin & 31;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
    count += binCount[bin];
  }
  // Spreads in 8-bit units so the three axes compare fairly.
  const rSpread = (rMax - rMin) << 3;
  const gSpread = (gMax - gMin) << 2;
  const bSpread = (bMax - bMin) << 3;
  let axis = 1;
  let spread = gSpread;
  if (rSpread > spread) {
    axis = 0;
    spread = rSpread;
  }
  if (bSpread > spread) {
    axis = 2;
    spread = bSpread;
  }
  const splittable = end - start >= 2 && spread > 0;
  return {
    start,
    end,
    count,
    axis,
    score: splittable ? spread * Math.sqrt(count) : 0,
  };
}

/** Build a palette of at most `maxColors` from the current histogram
 *  and fill `binToIndex`. Returns RGB triples and the colour count. */
function buildPalette(maxColors: number): { palette: Uint8Array; size: number } {
  let used = 0;
  for (let bin = 0; bin < BINS; bin++) {
    if (binCount[bin] !== 0) binOrder[used++] = bin;
  }
  if (used === 0) return { palette: new Uint8Array(0), size: 0 };

  const boxes: Box[] = [measureBox(0, used)];
  while (boxes.length < maxColors) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].score > bestScore) {
        bestScore = boxes[i].score;
        best = i;
      }
    }
    if (best < 0) break; // every box is a single colour already

    const box = boxes[best];
    const slice = binOrder.subarray(box.start, box.end);
    if (box.axis === 0) slice.sort((a, b) => (a >> 11) - (b >> 11));
    else if (box.axis === 1) slice.sort((a, b) => ((a >> 5) & 63) - ((b >> 5) & 63));
    else slice.sort((a, b) => (a & 31) - (b & 31));

    // Cut where half of the box's pixels fall on each side, keeping at
    // least one bin in both halves.
    const half = box.count / 2;
    let acc = 0;
    let cut = box.start + 1;
    for (let i = box.start; i < box.end - 1; i++) {
      acc += binCount[binOrder[i]];
      cut = i + 1;
      if (acc >= half) break;
    }
    boxes[best] = measureBox(box.start, cut);
    boxes.push(measureBox(cut, box.end));
  }

  const palette = new Uint8Array(boxes.length * 3);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    let r = 0, g = 0, b = 0, count = 0;
    for (let j = box.start; j < box.end; j++) {
      const bin = binOrder[j];
      r += binR[bin];
      g += binG[bin];
      b += binB[bin];
      count += binCount[bin];
      binToIndex[bin] = i;
    }
    palette[i * 3] = Math.round(r / count);
    palette[i * 3 + 1] = Math.round(g / count);
    palette[i * 3 + 2] = Math.round(b / count);
  }
  return { palette, size: boxes.length };
}

// ——— GIF container ————————————————————————————————————————————————

/** "Leave the frame in place" — what frame differencing relies on. */
const DISPOSE_KEEP = 1;
/** "Restore to background" — used when frames have real transparency. */
const DISPOSE_BACKGROUND = 2;

function writeHeader(out: ByteSink, width: number, height: number): void {
  out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  out.u16(width);
  out.u16(height);
  out.byte(0x70); // no global colour table, 8 bits of colour resolution
  out.byte(0); // background colour index
  out.byte(0); // pixel aspect ratio
  // NETSCAPE2.0 application extension: loop forever.
  out.bytes([0x21, 0xff, 0x0b]);
  out.bytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
}

/** Write one image with its own colour table. `tableColors` counts
 *  every entry in `table`, including a reserved transparent slot.
 *  Returns the byte offset of the delay field, so a later identical
 *  frame can extend it instead of adding a new image. */
function writeImage(
  out: ByteSink,
  x: number,
  y: number,
  w: number,
  h: number,
  indexed: Uint8Array,
  table: Uint8Array,
  tableColors: number,
  delayCs: number,
  transparentIndex: number,
  disposal: number,
): number {
  // Graphic Control Extension.
  out.bytes([0x21, 0xf9, 0x04]);
  out.byte((disposal << 2) | (transparentIndex >= 0 ? 1 : 0));
  const delayOffset = out.length;
  out.u16(delayCs);
  out.byte(transparentIndex >= 0 ? transparentIndex : 0);
  out.byte(0);

  // The colour table holds a power-of-two number of entries (2 to 256).
  let bits = 1;
  while (1 << bits < tableColors) bits++;

  // Image Descriptor, then the local colour table padded with black.
  out.byte(0x2c);
  out.u16(x);
  out.u16(y);
  out.u16(w);
  out.u16(h);
  out.byte(0x80 | (bits - 1));
  const padded = new Uint8Array((1 << bits) * 3);
  padded.set(table.subarray(0, tableColors * 3));
  out.bytes(padded);

  lzwEncode(indexed, Math.max(2, bits), out);
  return delayOffset;
}

// ——— frame encoding ————————————————————————————————————————————————

const MAX_DELAY_CS = 0xffff;

/** Streaming encoder: feed it same-sized RGBA frames in order. */
class GifStream {
  private out = new ByteSink();
  private prev: Uint32Array | null = null;
  /** Decided on the first frame: frames with see-through pixels are
   *  written whole, with real transparency, instead of differenced. */
  private alphaMode = false;
  private lastDelayOffset = -1;
  private lastDelayCs = 0;

  constructor(
    private width: number,
    private height: number,
  ) {
    writeHeader(this.out, width, height);
  }

  /** Add a frame. `rgba` is `width * height` little-endian RGBA pixels. */
  addFrame(rgba: Uint32Array, delayCs: number): void {
    const delay = Math.max(2, Math.min(MAX_DELAY_CS, Math.round(delayCs)));
    if (this.prev === null) {
      this.alphaMode = hasTransparency(rgba);
      if (this.alphaMode) this.writeAlphaFrame(rgba, delay);
      else this.writeFullFrame(rgba, delay);
    } else if (this.alphaMode) {
      this.writeAlphaFrame(rgba, delay);
    } else {
      this.writeChangedPixels(rgba, this.prev, delay);
    }
    this.prev = rgba;
  }

  finish(): Uint8Array {
    this.out.byte(0x3b); // trailer
    return this.out.finish();
  }

  private remember(delayOffset: number, delayCs: number): void {
    this.lastDelayOffset = delayOffset;
    this.lastDelayCs = delayCs;
  }

  /** First frame of an opaque clip: every pixel, up to 256 colours. */
  private writeFullFrame(cur: Uint32Array, delayCs: number): void {
    const { width, height } = this;
    resetHistogram();
    for (let p = 0; p < cur.length; p++) addPixel(cur[p]);
    const { palette, size } = buildPalette(256);

    const indexed = new Uint8Array(cur.length);
    for (let p = 0; p < cur.length; p++) indexed[p] = binToIndex[binOf(cur[p])];

    this.remember(
      writeImage(this.out, 0, 0, width, height, indexed, palette, size, delayCs, -1, DISPOSE_KEEP),
      delayCs,
    );
  }

  /** Later frame of an opaque clip: only what changed since `prev`,
   *  cropped to its bounding box, everything else transparent. */
  private writeChangedPixels(cur: Uint32Array, prev: Uint32Array, delayCs: number): void {
    const { width, height } = this;
    let minX = width, minY = height, maxX = -1, maxY = -1;

    resetHistogram();
    for (let y = 0, p = 0; y < height; y++) {
      for (let x = 0; x < width; x++, p++) {
        const v = cur[p];
        if (v === prev[p]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        addPixel(v);
      }
    }

    if (maxX < 0) {
      // Nothing changed: hold the previous image longer rather than
      // storing another one.
      const merged = this.lastDelayCs + delayCs;
      if (this.lastDelayOffset >= 0 && merged <= MAX_DELAY_CS) {
        this.out.setU16(this.lastDelayOffset, merged);
        this.lastDelayCs = merged;
        return;
      }
      // The delay field is full; add a 1 × 1 transparent placeholder.
      this.remember(
        writeImage(this.out, 0, 0, 1, 1, new Uint8Array(1), new Uint8Array(6), 2, delayCs, 0, DISPOSE_KEEP),
        delayCs,
      );
      return;
    }

    // Slot 0 is the transparent "unchanged" marker; colours follow it.
    const { palette, size } = buildPalette(255);
    const table = new Uint8Array((size + 1) * 3);
    table.set(palette, 3);

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const indexed = new Uint8Array(w * h);
    for (let y = 0, o = 0; y < h; y++) {
      let p = (minY + y) * width + minX;
      for (let x = 0; x < w; x++, p++, o++) {
        const v = cur[p];
        indexed[o] = v === prev[p] ? 0 : binToIndex[binOf(v)] + 1;
      }
    }

    this.remember(
      writeImage(this.out, minX, minY, w, h, indexed, table, size + 1, delayCs, 0, DISPOSE_KEEP),
      delayCs,
    );
  }

  /** A frame with see-through pixels: written whole, with slot 0 as
   *  real transparency, and cleared before the next frame is drawn. */
  private writeAlphaFrame(cur: Uint32Array, delayCs: number): void {
    const { width, height } = this;
    resetHistogram();
    for (let p = 0; p < cur.length; p++) {
      const v = cur[p];
      if (v >>> 24 >= 128) addPixel(v);
    }
    const { palette, size } = buildPalette(255);
    const table = new Uint8Array((size + 1) * 3);
    table.set(palette, 3);

    const indexed = new Uint8Array(cur.length);
    for (let p = 0; p < cur.length; p++) {
      const v = cur[p];
      indexed[p] = v >>> 24 >= 128 ? binToIndex[binOf(v)] + 1 : 0;
    }

    this.remember(
      writeImage(this.out, 0, 0, width, height, indexed, table, size + 1, delayCs, 0, DISPOSE_BACKGROUND),
      delayCs,
    );
  }
}

function hasTransparency(rgba: Uint32Array): boolean {
  for (let p = 0; p < rgba.length; p++) {
    if (rgba[p] >>> 24 !== 255) return true;
  }
  return false;
}

// ——— public API ————————————————————————————————————————————————————

/** Encode already-rendered frames. Every `rgba` holds `width * height`
 *  pixels as little-endian RGBA; `delayMs` is how long each one shows. */
export function encodeGifFrames(
  width: number,
  height: number,
  frames: { rgba: Uint32Array; delayMs: number }[],
): Uint8Array {
  const stream = new GifStream(width, height);
  for (const f of frames) stream.addFrame(f.rgba, f.delayMs / 10);
  return stream.finish();
}

/** Render the clip the way the Player shows it and encode it as a GIF. */
export async function encodeGif(opts: GifEncodeOptions): Promise<Uint8Array> {
  const { thumbs, trim, edits, inputEvents, fps, frameDelays, spotlight } = opts;

  const playable = applyTrim(thumbs, trim);
  if (playable.length === 0) {
    throw new Error("Nothing to export: there are no frames in the current selection.");
  }

  const imageCache = await loadEditImages(playable, edits);
  const layers = { edits, inputEvents, spotlight, imageCache };

  // Same timing as the Player: one tick of the clip's frame rate per
  // frame, plus any hold the frame was given. GIF delays are whole
  // centiseconds, so the rounding error is carried forward to keep the
  // overall length right.
  const baseMs = 1000 / Math.max(1, fps);
  let carryMs = 0;

  let stream: GifStream | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let width = 0;
  let height = 0;

  const total = playable.length;
  for (let i = 0; i < total; i++) {
    const t = playable[i];
    const bitmap = await loadFrameBitmap(t);

    if (stream === null || ctx === null) {
      width = bitmap.width;
      height = bitmap.height;
      const canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Could not create a canvas to render frames");
      stream = new GifStream(width, height);
    }

    ctx.clearRect(0, 0, width, height);
    paintFrame(ctx as unknown as CanvasRenderingContext2D, bitmap, t, width, height, layers);
    bitmap.close();

    const data = ctx.getImageData(0, 0, width, height).data;
    const rgba = new Uint32Array(data.buffer, data.byteOffset, width * height);

    const wantMs = baseMs + (frameDelays?.[t.index] ?? 0) + carryMs;
    const delayCs = Math.max(2, Math.round(wantMs / 10));
    carryMs = Math.max(-5, Math.min(5, wantMs - delayCs * 10));
    stream.addFrame(rgba, delayCs);

    opts.onProgress?.(i + 1, total);
    // Let the UI repaint the progress between frames.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (stream === null) throw new Error("No frames were encoded");
  return stream.finish();
}
