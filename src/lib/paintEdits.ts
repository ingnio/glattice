// Shared canvas-2d rendering for the frame editor + player.
// Keeps preview output identical between the Zoom view (where edits are
// authored) and the Player view (where they're played back).

import { Edit, colorToCss } from "./edits";
import type { InputEvent } from "./tauri";

// How long an event remains visible after it fires.
const CLICK_LIFETIME_MS = 600;
const KEY_LIFETIME_MS = 1500;

// Mirror of `cursor::GLYPH` in src-tauri/src/cursor.rs. 0 = transparent,
// 1 = white outline, 2 = black body. The hotspot is at (0,0).
const CURSOR_GLYPH: ReadonlyArray<ReadonlyArray<number>> = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0],
  [1, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0],
  [1, 2, 2, 2, 2, 2, 1, 0, 0, 0, 0],
  [1, 2, 2, 2, 2, 2, 2, 1, 0, 0, 0],
  [1, 2, 2, 2, 2, 2, 2, 2, 1, 0, 0],
  [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0],
  [1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
  [1, 2, 2, 1, 2, 2, 2, 1, 0, 0, 0],
  [1, 2, 1, 0, 1, 2, 2, 1, 0, 0, 0],
  [1, 1, 0, 0, 1, 2, 2, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 1, 2, 2, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
];

/**
 * Draw expanding ring overlays for any clicks within the visible
 * window of the current frame. Each ring grows from radius 6 to 32
 * over `CLICK_LIFETIME_MS` and fades to transparent.
 */
export function drawClicks(
  ctx: CanvasRenderingContext2D,
  events: InputEvent[],
  frameMs: number,
  canvasW: number,
  canvasH: number,
): void {
  ctx.save();
  for (const e of events) {
    if (e.kind !== "click") continue;
    const age = frameMs - e.timestampMs;
    if (age < 0 || age > CLICK_LIFETIME_MS) continue;
    if (e.x < 0 || e.y < 0 || e.x > canvasW || e.y > canvasH) continue;
    const t = age / CLICK_LIFETIME_MS;
    // Diameter sized off the canvas so the ring stays readable on
    // both small region recordings and full-monitor captures.
    const baseR = Math.max(6, Math.min(canvasW, canvasH) * 0.012);
    const radius = baseR + t * baseR * 4;
    const alpha = 1 - t;
    const color =
      e.button === "right"
        ? `rgba(239, 68, 68, ${alpha})`
        : e.button === "middle"
          ? `rgba(168, 85, 247, ${alpha})`
          : `rgba(250, 204, 21, ${alpha})`;
    ctx.lineWidth = Math.max(2, baseR * 0.4);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // Soft inner dot at the click point so the moment of impact is
    // unambiguous even after the ring grows.
    if (t < 0.4) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, baseR * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Format a single key event into a readable token like "Ctrl+S". */
function formatKey(e: Extract<InputEvent, { kind: "key" }>): string {
  const m = e.modifiers;
  const parts: string[] = [];
  if (m.ctrl) parts.push("Ctrl");
  if (m.alt) parts.push("Alt");
  if (m.shift) parts.push("Shift");
  if (m.meta) parts.push("Win");
  // Skip the trailing label if it's already one of the modifiers (the
  // recorder filters those out, but be defensive).
  parts.push(e.label);
  return parts.join("+");
}

/**
 * Draw recent key presses in the bottom-left corner. Older keys fade
 * out; only events within `KEY_LIFETIME_MS` of the current frame are
 * shown. Up to 5 recent keys at a time.
 */
export function drawKeys(
  ctx: CanvasRenderingContext2D,
  events: InputEvent[],
  frameMs: number,
  canvasW: number,
  canvasH: number,
): void {
  // Collect the most recent visible key events (newest last).
  const visible: { text: string; age: number }[] = [];
  for (const e of events) {
    if (e.kind !== "key") continue;
    const age = frameMs - e.timestampMs;
    if (age < 0 || age > KEY_LIFETIME_MS) continue;
    visible.push({ text: formatKey(e), age });
  }
  if (visible.length === 0) return;
  // Cap to the 5 newest so the corner doesn't fill up under fast typing.
  const recent = visible.slice(-5);

  const fontPx = Math.max(14, Math.round(Math.min(canvasW, canvasH) * 0.022));
  const padX = fontPx * 0.65;
  const padY = fontPx * 0.4;
  const gap = fontPx * 0.45;
  ctx.save();
  ctx.font = `600 ${fontPx}px "Roboto Mono", ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "alphabetic";
  // Stack chips upward from the bottom-left.
  const baseX = Math.round(canvasW * 0.025);
  const baseY = Math.round(canvasH - canvasH * 0.04);
  let cursorY = baseY;
  for (let i = recent.length - 1; i >= 0; i--) {
    const { text, age } = recent[i];
    const alpha = 1 - age / KEY_LIFETIME_MS;
    const w = Math.ceil(ctx.measureText(text).width);
    const boxW = w + padX * 2;
    const boxH = fontPx + padY * 2;
    const x = baseX;
    const y = cursorY - boxH;
    // Pill background.
    ctx.fillStyle = `rgba(15, 17, 21, ${0.78 * alpha})`;
    roundedRect(ctx, x, y, boxW, boxH, fontPx * 0.35);
    ctx.fill();
    // Outline keeps the chip visible against dark UIs.
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Label.
    ctx.fillStyle = `rgba(245, 247, 252, ${alpha})`;
    ctx.fillText(text, x + padX, y + padY + fontPx * 0.85);
    cursorY = y - gap;
  }
  ctx.restore();
}

/**
 * Re-blit the captured cursor on top of any edits. Called after
 * paintEdit so simplify pills / blur / shapes can't bury the cursor.
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();
  for (let row = 0; row < CURSOR_GLYPH.length; row++) {
    for (let col = 0; col < CURSOR_GLYPH[row].length; col++) {
      const v = CURSOR_GLYPH[row][col];
      if (v === 0) continue;
      ctx.fillStyle = v === 1 ? "#ffffff" : "#000000";
      ctx.fillRect(x + col, y + row, 1, 1);
    }
  }
  ctx.restore();
}

/**
 * Draw a frame-number / timestamp annotation in a corner of the canvas.
 * Mirrors the Rust sprite.rs annotation logic so the Grid live preview
 * matches the exported sheet as closely as possible.
 */
export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  frameIndex: number,
  elapsedMs: number,
  showFrameNumber: boolean,
  showTimestamp: boolean,
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right",
): void {
  if (!showFrameNumber && !showTimestamp) return;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  const parts: string[] = [];
  if (showFrameNumber) parts.push(`f${frameIndex + 1}`);
  if (showTimestamp) {
    const totalCs = Math.floor(elapsedMs / 10);
    const secs = Math.floor(totalCs / 100);
    const cs = totalCs % 100;
    parts.push(`${secs}.${String(cs).padStart(2, "0")}s`);
  }
  const text = parts.join(" ");

  const fontPx = Math.max(10, Math.round(Math.min(w, h) * 0.05));
  const padX = fontPx * 0.5;
  const padY = fontPx * 0.3;
  const margin = Math.round(fontPx * 0.35);

  ctx.save();
  ctx.font = `600 ${fontPx}px "Roboto Mono", ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "top";

  const tw = Math.ceil(ctx.measureText(text).width);
  const boxW = tw + padX * 2;
  const boxH = fontPx + padY * 2;

  let x: number;
  let y: number;
  switch (position) {
    case "top-right":    x = w - margin - boxW; y = margin;          break;
    case "bottom-left":  x = margin;            y = h - margin - boxH; break;
    case "bottom-right": x = w - margin - boxW; y = h - margin - boxH; break;
    default:             x = margin;            y = margin;           break;
  }

  ctx.fillStyle = "rgba(15, 17, 21, 0.75)";
  roundedRect(ctx, x, y, boxW, boxH, fontPx * 0.3);
  ctx.fill();

  ctx.fillStyle = "rgba(245, 247, 252, 0.95)";
  ctx.fillText(text, x + padX, y + padY);
  ctx.restore();
}

/** Break `text` into lines that each fit within `maxWidth` at the
 *  current `ctx.font` setting. Respects explicit line breaks and keeps
 *  whitespace-separated words intact. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    if (!para) {
      out.push("");
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const candidate = line + w;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line.replace(/\s+$/, ""));
        line = /^\s+$/.test(w) ? "" : w;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Draw a spotlight vignette centred at `(cx, cy)`. Everything outside
 * the spotlight is dimmed by `dimOpacity`. The edge is feathered with a
 * radial gradient so the transition is soft rather than a hard cutoff.
 */
export function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  dimOpacity: number,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const feather = radius * 0.25;
  const innerR = Math.max(0, radius - feather);
  const outerR = radius + feather * 0.5;

  ctx.save();

  // Solid dim layer covering everything outside the outer radius.
  // Even-odd fill rule punches a circular hole in the rect.
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2, true);
  ctx.fillStyle = `rgba(0,0,0,${dimOpacity})`;
  ctx.fill("evenodd");

  // Gradient feather ring from transparent (innerR) → dim (outerR).
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${dimOpacity})`);
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
  ctx.fillStyle = grad;
  ctx.fill("evenodd");

  ctx.restore();
}

export function paintEdit(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  e: Edit,
  opts?: { isDraft?: boolean },
): void {
  const stroke = colorToCss(
    e.kind === "blur" || e.kind === "simplify" ? [0, 0, 0, 255] : e.color,
  );
  switch (e.kind) {
    case "rect": {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = e.thickness;
      ctx.lineJoin = "miter";
      if (e.fill) {
        ctx.fillStyle = stroke;
        ctx.fillRect(e.x, e.y, e.w, e.h);
      } else {
        ctx.strokeRect(e.x, e.y, e.w, e.h);
      }
      ctx.restore();
      break;
    }
    case "ellipse": {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = e.thickness;
      ctx.beginPath();
      ctx.ellipse(
        e.x + e.w / 2,
        e.y + e.h / 2,
        Math.max(e.w / 2, 0.5),
        Math.max(e.h / 2, 0.5),
        0,
        0,
        Math.PI * 2,
      );
      if (e.fill) {
        ctx.fillStyle = stroke;
        ctx.fill();
      } else {
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "arrow": {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.fillStyle = stroke;
      ctx.lineWidth = e.thickness;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const dx = e.x2 - e.x1;
      const dy = e.y2 - e.y1;
      const len = Math.hypot(dx, dy);
      const headLen = Math.max(e.thickness * 3, 12);
      const angle = Math.atan2(dy, dx);
      const shaftLen = Math.max(len - headLen * 0.6, 0);
      const sx = e.x1;
      const sy = e.y1;
      const ex = e.x1 + Math.cos(angle) * shaftLen;
      const ey = e.y1 + Math.sin(angle) * shaftLen;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(e.x2, e.y2);
      ctx.lineTo(
        e.x2 - Math.cos(angle - Math.PI / 7) * headLen,
        e.y2 - Math.sin(angle - Math.PI / 7) * headLen,
      );
      ctx.lineTo(
        e.x2 - Math.cos(angle + Math.PI / 7) * headLen,
        e.y2 - Math.sin(angle + Math.PI / 7) * headLen,
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "freehand": {
      if (e.points.length < 2) break;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = e.thickness;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(e.points[0][0], e.points[0][1]);
      for (let i = 1; i < e.points.length; i++) {
        ctx.lineTo(e.points[i][0], e.points[i][1]);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "text": {
      if (!e.text) {
        // Empty text boxes are a live "I'm drawing this" preview —
        // show a dashed outline so the user can see what they're
        // shaping. The outline isn't rendered at export time since
        // empty edits are discarded on commit.
        if (e.w < 1 || e.h < 1) break;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
        ctx.restore();
        break;
      }
      ctx.save();
      ctx.fillStyle = stroke;
      ctx.font = `600 ${e.sizePx}px "Roboto Mono", ui-monospace, Menlo, monospace`;
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
      ctx.shadowBlur = Math.max(2, e.sizePx / 10);
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
      ctx.beginPath();
      ctx.rect(e.x, e.y, e.w, e.h);
      ctx.clip();
      const lines = wrapText(ctx, e.text, e.w);
      const lineH = e.sizePx * 1.2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], e.x, e.y + i * lineH);
      }
      ctx.restore();
      break;
    }
    case "blur": {
      if (e.w < 1 || e.h < 1) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(e.x, e.y, e.w, e.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(2, e.radius)}px)`;
      ctx.drawImage(
        img,
        Math.max(0, e.x - e.radius),
        Math.max(0, e.y - e.radius),
        e.w + e.radius * 2,
        e.h + e.radius * 2,
        Math.max(0, e.x - e.radius),
        Math.max(0, e.y - e.radius),
        e.w + e.radius * 2,
        e.h + e.radius * 2,
      );
      ctx.restore();
      break;
    }
    case "simplify": {
      if (e.w < 1 || e.h < 1) break;
      const bands = detectTextBands(img, e.x, e.y, e.w, e.h, {
        blockSize: e.blockSize,
        threshold: e.threshold,
        merge: e.merge,
        padding: e.padding,
      });
      const roundness = clamp(
        e.roundness ?? SIMPLIFY_DEFAULTS.roundness,
        0,
        64,
      );
      ctx.save();
      for (const b of bands) {
        ctx.fillStyle = colorToCss(b.color);
        const bw = b.x1 - b.x0 + 1;
        const bh = b.y1 - b.y0 + 1;
        if (b.shape === "circle") {
          ctx.beginPath();
          ctx.ellipse(
            b.x0 + bw / 2,
            b.y0 + bh / 2,
            Math.max(bw / 2, 0.5),
            Math.max(bh / 2, 0.5),
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else {
          const rad = Math.min(bh / 2, roundness);
          roundedRect(ctx, b.x0, b.y0, bw, bh, rad);
          ctx.fill();
        }
      }
      ctx.restore();
      // Show the dashed region outline only while the user is actively
      // creating the edit (drafting). Once committed, the bars stand on
      // their own; selection / resize gets its outline from the
      // separate selection-overlay pass.
      if (opts?.isDraft) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(110, 168, 255, 1)";
        ctx.globalAlpha = bands.length === 0 ? 0.85 : 0.45;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
        ctx.restore();
      }
      break;
    }
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Heuristic text-row detection in image pixels.
 *
 * Rows where a large fraction of adjacent pixels have big luminance
 * jumps are almost always text (glyph edges flip light→dark many times
 * per row). We count those edges per row, then merge consecutive
 * text-dense rows into bands — the output is one band per visible line
 * of text. Each band's x-extent comes from the leftmost and rightmost
 * text-edge columns inside it, so short lines get short pills.
 *
 * The image is sampled via a scratch canvas so we don't need the raw
 * pixel buffer from the caller.
 */
export interface SimplifyBand {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  color: [number, number, number, number];
  /** "rect" → rounded pill (text lines, generic shapes).
   *  "circle" → filled ellipse for components that look round (icons,
   *  avatars, dots — components whose bbox is roughly square AND whose
   *  foreground coverage is high). */
  shape: "rect" | "circle";
}

export interface SimplifySettings {
  blockSize?: number;
  threshold?: number;
  merge?: number;
  padding?: number;
  roundness?: number;
}

/** Defaults used when a simplify edit doesn't override a setting.
 *  Exposed so the UI can seed its sliders from the same numbers. */
export const SIMPLIFY_DEFAULTS = {
  blockSize: 4,
  threshold: 18,
  merge: 4,
  padding: 1,
  roundness: 6,
} as const;

export function detectTextBands(
  img: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  settings?: SimplifySettings,
): SimplifyBand[] {
  // Snap source coords to integer pixel boundaries so the offscreen
  // canvas blit is a 1:1 copy (no interpolation, no sub-pixel drift).
  // Otherwise large regions accumulate scale-error and the detected
  // bands shift relative to the underlying glyphs.
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const w = Math.max(1, Math.ceil(sx + sw) - ix);
  const h = Math.max(1, Math.ceil(sy + sh) - iy);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");
  if (!octx) return [];
  octx.drawImage(img, ix, iy, w, h, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = octx.getImageData(0, 0, w, h).data;
  } catch {
    return [];
  }
  return scanBands(data, w, h, ix, iy, settings);
}

function scanBands(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  settings?: SimplifySettings,
): SimplifyBand[] {
  // K-means clustering pipeline:
  //   1. Downsample into fixed-size blocks (box average) — this acts
  //      as a fast blur that absorbs per-pixel AA noise into each
  //      block's mean colour.
  //   2. K-means cluster the block colours into a small palette.
  //      The "Sensitivity" slider controls K (the cluster count).
  //   3. Treat the most-populous cluster as background. For each
  //      remaining cluster, dilate horizontally and pull connected
  //      components — those become the bars.
  //   4. Each bar fills with its cluster's centroid colour, so the
  //      output settles into a small, cohesive palette.
  const FACTOR = clampInt(
    settings?.blockSize ?? SIMPLIFY_DEFAULTS.blockSize,
    1,
    16,
  );
  const mergeR = clampInt(
    settings?.merge ?? SIMPLIFY_DEFAULTS.merge,
    0,
    32,
  );
  const pad = clamp(
    settings?.padding ?? SIMPLIFY_DEFAULTS.padding,
    0,
    8,
  );
  // Sensitivity slider (4..50) → K (2..10).
  const tParam = settings?.threshold ?? SIMPLIFY_DEFAULTS.threshold;
  const K = clampInt(2 + Math.round((tParam - 4) / 6), 2, 10);

  const bw = Math.max(1, Math.ceil(w / FACTOR));
  const bh = Math.max(1, Math.ceil(h / FACTOR));

  const blockR = new Float32Array(bw * bh);
  const blockG = new Float32Array(bw * bh);
  const blockB = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    const y0 = by * FACTOR;
    const y1 = Math.min(y0 + FACTOR, h);
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * FACTOR;
      const x1 = Math.min(x0 + FACTOR, w);
      let sr = 0,
        sg = 0,
        sb = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          const di = (row + x) * 4;
          sr += data[di];
          sg += data[di + 1];
          sb += data[di + 2];
          n++;
        }
      }
      const bi = by * bw + bx;
      blockR[bi] = sr / n;
      blockG[bi] = sg / n;
      blockB[bi] = sb / n;
    }
  }

  const { labels, cR, cG, cB, counts } = kmeans(blockR, blockG, blockB, K);
  // Most-populous cluster = background.
  let bgCluster = 0;
  for (let k = 1; k < K; k++) {
    if (counts[k] > counts[bgCluster]) bgCluster = k;
  }

  const bands: SimplifyBand[] = [];
  const minW = Math.max(2, Math.round(mergeR * 1.2));
  const minH = 2;
  const padX = pad;
  const padY = pad;

  for (let k = 0; k < K; k++) {
    if (k === bgCluster) continue;
    const mask = new Uint8Array(bw * bh);
    let any = false;
    for (let i = 0; i < bw * bh; i++) {
      if (labels[i] === k) {
        mask[i] = 1;
        any = true;
      }
    }
    if (!any) continue;
    const dilated = horizontalDilate(mask, bw, bh, mergeR);
    const components = connectedComponents(dilated, bw, bh);
    const clusterColor: [number, number, number, number] = [
      Math.round(cR[k]),
      Math.round(cG[k]),
      Math.round(cB[k]),
      255,
    ];
    for (const c of components) {
      let tx0 = c.x1 + 1,
        ty0 = c.y1 + 1,
        tx1 = -1,
        ty1 = -1;
      let cnt = 0;
      for (let y = c.y0; y <= c.y1; y++) {
        const row = y * bw;
        for (let x = c.x0; x <= c.x1; x++) {
          if (!mask[row + x]) continue;
          if (x < tx0) tx0 = x;
          if (x > tx1) tx1 = x;
          if (y < ty0) ty0 = y;
          if (y > ty1) ty1 = y;
          cnt++;
        }
      }
      if (tx1 < tx0 || ty1 < ty0 || cnt === 0) continue;
      const origW = tx1 - tx0 + 1;
      const origH = ty1 - ty0 + 1;
      if (origW < minW || origH < minH) continue;
      const aspect = origW / origH;
      const coverage = cnt / (origW * origH);
      const shape: "rect" | "circle" =
        aspect >= 0.7 && aspect <= 1.4 && coverage >= 0.55 ? "circle" : "rect";
      tx0 = Math.max(0, tx0 - padX);
      ty0 = Math.max(0, ty0 - padY);
      tx1 = Math.min(bw - 1, tx1 + padX);
      ty1 = Math.min(bh - 1, ty1 + padY);
      const px0 = tx0 * FACTOR;
      const py0 = ty0 * FACTOR;
      const px1 = Math.min(w - 1, (tx1 + 1) * FACTOR - 1);
      const py1 = Math.min(h - 1, (ty1 + 1) * FACTOR - 1);
      bands.push({
        y0: py0 + offsetY,
        y1: py1 + offsetY,
        x0: px0 + offsetX,
        x1: px1 + offsetX,
        color: clusterColor,
        shape,
      });
    }
  }
  return bands;
}

/**
 * K-means on a flat list of RGB samples. Deterministic init: sort
 * inputs by luminance and pick K equally-spaced seeds, so the same
 * edit always produces the same labels (no random jitter between
 * paint passes).
 */
function kmeans(
  rs: Float32Array,
  gs: Float32Array,
  bs: Float32Array,
  K: number,
): {
  labels: Uint8Array;
  cR: Float32Array;
  cG: Float32Array;
  cB: Float32Array;
  counts: Uint32Array;
} {
  const N = rs.length;
  const cR = new Float32Array(K);
  const cG = new Float32Array(K);
  const cB = new Float32Array(K);
  const lums = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lums[i] = 0.299 * rs[i] + 0.587 * gs[i] + 0.114 * bs[i];
  }
  const sortedIdx = new Uint32Array(N);
  for (let i = 0; i < N; i++) sortedIdx[i] = i;
  sortedIdx.sort((a, b) => lums[a] - lums[b]);
  for (let k = 0; k < K; k++) {
    const idx = sortedIdx[Math.min(N - 1, Math.floor((k + 0.5) * N / K))];
    cR[k] = rs[idx];
    cG[k] = gs[idx];
    cB[k] = bs[idx];
  }

  const labels = new Uint8Array(N);
  const ITERS = 8;
  for (let it = 0; it < ITERS; it++) {
    // Assign labels.
    for (let i = 0; i < N; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < K; k++) {
        const dr = rs[i] - cR[k];
        const dg = gs[i] - cG[k];
        const db = bs[i] - cB[k];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      labels[i] = best;
    }
    // Update centroids.
    const sumR = new Float32Array(K);
    const sumG = new Float32Array(K);
    const sumB = new Float32Array(K);
    const counts = new Uint32Array(K);
    for (let i = 0; i < N; i++) {
      const k = labels[i];
      sumR[k] += rs[i];
      sumG[k] += gs[i];
      sumB[k] += bs[i];
      counts[k]++;
    }
    for (let k = 0; k < K; k++) {
      if (counts[k] > 0) {
        cR[k] = sumR[k] / counts[k];
        cG[k] = sumG[k] / counts[k];
        cB[k] = sumB[k] / counts[k];
      }
    }
  }

  // Final cluster sizes.
  const finalCounts = new Uint32Array(K);
  for (let i = 0; i < N; i++) finalCounts[labels[i]]++;
  return { labels, cR, cG, cB, counts: finalCounts };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function horizontalDilate(
  mask: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    // Prime the window with the first r+1 columns.
    for (let x = 0; x < Math.min(r + 1, w); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      out[row + x] = count > 0 ? 1 : 0;
      const adding = x + r + 1;
      const removing = x - r;
      if (adding < w) count += mask[row + adding];
      if (removing >= 0) count -= mask[row + removing];
    }
  }
  return out;
}

function connectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const visited = new Uint8Array(w * h);
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (visited[start] || !mask[start]) continue;
      let x0 = x,
        y0 = y,
        x1 = x,
        y1 = y;
      stack.length = 0;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop()!;
        if (visited[i] || !mask[i]) continue;
        visited[i] = 1;
        const cx = i % w;
        const cy = (i - cx) / w;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        if (cx > 0) stack.push(i - 1);
        if (cx < w - 1) stack.push(i + 1);
        if (cy > 0) stack.push(i - w);
        if (cy < h - 1) stack.push(i + w);
      }
      out.push({ x0, y0, x1, y1 });
    }
  }
  return out;
}

