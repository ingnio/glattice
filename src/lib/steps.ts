// Step-by-step guides: turn a recording into a numbered list of
// "do this, then this" pictures with captions.
//
// A step is a point on a frame. Steps come from one of two places:
//   - the clicks captured during recording (Settings → Show clicks), or
//   - the numbered markers placed with the Editor's Step tool.
// Each step is shown as a crop of its frame around that point, with the
// point highlighted, next to a caption the user can edit.

import { Edit, FrameEdits, getFrameEdits } from "./edits";
import { loadEditImages, loadFrameBitmap, paintFrame } from "./renderFrame";
import { FrameThumb, InputEvent } from "./tauri";

export type StepSource = "clicks" | "markers";

export interface GuideStep {
  /** Stable key for lists; unique within a guide. */
  id: string;
  /** Original index of the frame this step is shown on. */
  frameIndex: number;
  /** The point being shown, in source-frame pixels. */
  x: number;
  y: number;
  caption: string;
}

export interface Guide {
  title: string;
  source: StepSource;
  steps: GuideStep[];
}

/** Two clicks this close together in time and space are one action
 *  (a double-click), not two steps. */
const SAME_CLICK_MS = 500;
const SAME_CLICK_PX = 8;

const CLICK_CAPTIONS = {
  left: "Click here",
  right: "Right-click here",
  middle: "Middle-click here",
} as const;

/** One step per click, in the order they happened. `thumbs` is the clip
 *  as it will be exported: trimmed, in display order. A click is shown on
 *  the last frame captured before it, which is the screen as it looked
 *  when the click was made. Clicks outside the kept frames are dropped. */
export function stepsFromClicks(thumbs: FrameThumb[], events: InputEvent[]): GuideStep[] {
  if (thumbs.length === 0) return [];
  const byTime = [...thumbs].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const firstMs = byTime[0].elapsedMs;
  // A click after the last frame still belongs to that frame, within one
  // frame's worth of time.
  const tail =
    byTime.length > 1
      ? byTime[byTime.length - 1].elapsedMs - byTime[byTime.length - 2].elapsedMs
      : 1000;
  const lastMs = byTime[byTime.length - 1].elapsedMs + Math.max(tail, 100);

  const steps: GuideStep[] = [];
  let prev: { t: number; x: number; y: number } | null = null;
  const clicks = events
    .filter((e): e is Extract<InputEvent, { kind: "click" }> => e.kind === "click")
    .sort((a, b) => a.timestampMs - b.timestampMs);

  for (const c of clicks) {
    if (c.timestampMs < firstMs || c.timestampMs > lastMs) continue;
    if (
      prev &&
      c.timestampMs - prev.t <= SAME_CLICK_MS &&
      Math.hypot(c.x - prev.x, c.y - prev.y) <= SAME_CLICK_PX
    ) {
      prev = { t: c.timestampMs, x: c.x, y: c.y };
      continue;
    }
    prev = { t: c.timestampMs, x: c.x, y: c.y };
    let frame = byTime[0];
    for (const t of byTime) {
      if (t.elapsedMs <= c.timestampMs) frame = t;
      else break;
    }
    steps.push({
      id: `c${c.timestampMs}-${steps.length}`,
      frameIndex: frame.index,
      x: c.x,
      y: c.y,
      caption: CLICK_CAPTIONS[c.button] ?? CLICK_CAPTIONS.left,
    });
  }
  return steps;
}

/** One step per Step-tool marker, ordered by frame and then by the
 *  number on the marker. */
export function stepsFromMarkers(thumbs: FrameThumb[], edits: FrameEdits): GuideStep[] {
  const steps: GuideStep[] = [];
  for (const t of thumbs) {
    const markers = getFrameEdits(edits, t.index)
      .filter((e): e is Extract<Edit, { kind: "step" }> => e.kind === "step")
      .sort((a, b) => a.n - b.n);
    for (const m of markers) {
      steps.push({
        id: `m${t.index}-${m.n}-${steps.length}`,
        frameIndex: t.index,
        x: m.x,
        y: m.y,
        caption: "",
      });
    }
  }
  return steps;
}

/** Where a clip's steps can come from. Markers come first: placing them
 *  is a deliberate act, so they win when both exist. */
export function availableSources(
  thumbs: FrameThumb[],
  events: InputEvent[],
  edits: FrameEdits,
): StepSource[] {
  const out: StepSource[] = [];
  if (stepsFromMarkers(thumbs, edits).length > 0) out.push("markers");
  if (stepsFromClicks(thumbs, events).length > 0) out.push("clicks");
  return out;
}

export function buildSteps(
  source: StepSource,
  thumbs: FrameThumb[],
  events: InputEvent[],
  edits: FrameEdits,
): GuideStep[] {
  return source === "markers" ? stepsFromMarkers(thumbs, edits) : stepsFromClicks(thumbs, events);
}

// ——— rendering one step ————————————————————————————————————————————

const HIGHLIGHT = "37, 99, 235"; // the app's accent blue

/** Draw the step's picture: the frame as edited, cropped around the
 *  step's point, with the point ringed. Step-tool markers are left out of
 *  the picture, because the guide numbers its steps itself and a marker
 *  saying "1" on step 4 would only confuse. */
export async function renderStepImage(
  thumb: FrameThumb,
  edits: FrameEdits,
  step: GuideStep,
): Promise<HTMLCanvasElement> {
  const bitmap = await loadFrameBitmap(thumb);
  try {
    const fw = bitmap.width;
    const fh = bitmap.height;
    const withoutMarkers: FrameEdits = {
      ...edits,
      [thumb.index]: getFrameEdits(edits, thumb.index).filter((e) => e.kind !== "step"),
    };
    const full = document.createElement("canvas");
    full.width = fw;
    full.height = fh;
    const fctx = full.getContext("2d");
    if (!fctx) throw new Error("Could not draw the step.");
    const imageCache = await loadEditImages([thumb], withoutMarkers);
    // Click rings and key labels are left out: the ring below marks the
    // spot, and a half-faded ring from an earlier click would mislead.
    paintFrame(fctx, bitmap, thumb, fw, fh, {
      edits: withoutMarkers,
      inputEvents: [],
      spotlight: null,
      imageCache,
    });

    // Crop: a 16:9 window a bit over half the frame wide, never smaller
    // than 480 px, never larger than the frame, kept inside the frame.
    const cw = Math.min(fw, Math.max(480, Math.round(fw * 0.55)));
    const ch = Math.min(fh, Math.round((cw * 9) / 16));
    const x0 = Math.round(Math.max(0, Math.min(step.x - cw / 2, fw - cw)));
    const y0 = Math.round(Math.max(0, Math.min(step.y - ch / 2, fh - ch)));

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Could not draw the step.");
    ctx.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);

    const px = step.x - x0;
    const py = step.y - y0;
    const r = Math.max(14, cw * 0.028);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${HIGHLIGHT}, 0.22)`;
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, r * 0.16);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, r - ctx.lineWidth * 0.6, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.strokeStyle = `rgba(${HIGHLIGHT}, 1)`;
    ctx.stroke();
    return out;
  } finally {
    bitmap.close();
  }
}

// ——— exporting a whole guide ———————————————————————————————————————

export interface RenderedStep {
  caption: string;
  image: HTMLCanvasElement;
}

/** The text shown for a step that has no caption yet. */
export function captionOrDefault(caption: string, number: number): string {
  const text = caption.trim();
  return text === "" ? `Step ${number}` : text;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

const FONT = '"Segoe UI", system-ui, -apple-system, Arial, sans-serif';

/** Lay the guide out as one tall image: title, a line of details, then
 *  each step as a numbered caption above its picture. Always on a white
 *  page, whatever the app's theme, since it is a document to share. */
export function composeGuideCanvas(title: string, details: string, steps: RenderedStep[]): HTMLCanvasElement {
  const PAD = 36;
  // Only as wide as the pictures need: a guide of small region shots
  // shouldn't sit in a wide page with blank space down the right. It
  // never goes below a width captions can be read at, or above the
  // width large shots are scaled down to.
  const MAX_CONTENT_W = 848;
  const MIN_CONTENT_W = 360;
  const widest = steps.reduce((w, s) => Math.max(w, s.image.width), 0);
  const contentW = Math.max(MIN_CONTENT_W, Math.min(MAX_CONTENT_W, widest));
  const W = contentW + PAD * 2;
  const BADGE = 15;
  const textX = PAD + BADGE * 2 + 12;
  const textW = W - PAD - textX;

  const measure = document.createElement("canvas").getContext("2d")!;
  const titleFont = `700 30px ${FONT}`;
  const detailFont = `400 14px ${FONT}`;
  const captionFont = `500 17px ${FONT}`;
  const CAPTION_LH = 24;

  measure.font = titleFont;
  const titleLines = wrapLines(measure, title.trim() || "Untitled guide", contentW);
  measure.font = captionFont;
  const laidOut = steps.map((s, i) => {
    const lines = wrapLines(measure, captionOrDefault(s.caption, i + 1), textW);
    const scale = Math.min(1, contentW / s.image.width);
    return {
      lines,
      w: Math.round(s.image.width * scale),
      h: Math.round(s.image.height * scale),
      image: s.image,
    };
  });

  let height = PAD + titleLines.length * 38 + 8 + 20 + 24;
  for (const s of laidOut) {
    height += Math.max(BADGE * 2, s.lines.length * CAPTION_LH) + 12 + s.h + 30;
  }
  height += PAD - 30;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(height, 200);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "alphabetic";

  let y = PAD;
  ctx.fillStyle = "#111827";
  ctx.font = titleFont;
  for (const line of titleLines) {
    y += 30;
    ctx.fillText(line, PAD, y);
    y += 8;
  }
  y += 8;
  ctx.fillStyle = "#6b7280";
  ctx.font = detailFont;
  y += 14;
  ctx.fillText(details, PAD, y);
  y += 12;
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(PAD, y, contentW, 1);
  y += 18;

  laidOut.forEach((s, i) => {
    const blockH = Math.max(BADGE * 2, s.lines.length * CAPTION_LH);
    // Number badge.
    ctx.beginPath();
    ctx.arc(PAD + BADGE, y + BADGE, BADGE, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${HIGHLIGHT})`;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${String(i + 1).length > 1 ? 13 : 15}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), PAD + BADGE, y + BADGE + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Caption.
    ctx.fillStyle = "#111827";
    ctx.font = captionFont;
    s.lines.forEach((line, k) => {
      ctx.fillText(line, textX, y + 20 + k * CAPTION_LH);
    });
    y += blockH + 12;
    // Picture, with a hairline border so light screenshots have an edge.
    ctx.drawImage(s.image, PAD, y, s.w, s.h);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD + 0.5, y + 0.5, s.w - 1, s.h - 1);
    y += s.h + 30;
  });

  return canvas;
}

export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode the image."));
        return;
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, "image/png");
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The guide as one self-contained web page: pictures are embedded, so
 *  the single file can be emailed, opened anywhere, or printed to PDF. */
export function guideHtml(title: string, details: string, steps: RenderedStep[]): string {
  const safeTitle = escapeHtml(title.trim() || "Untitled guide");
  const items = steps
    .map((s, i) => {
      const caption = escapeHtml(captionOrDefault(s.caption, i + 1)).replace(/\n/g, "<br>");
      return `    <li>\n      <p>${caption}</p>\n      <img src="${s.image.toDataURL("image/png")}" alt="Step ${i + 1}" width="${s.image.width}" height="${s.image.height}">\n    </li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; color: #111827; background: #fff; max-width: 880px; margin: 0 auto; padding: 36px 24px 60px; line-height: 1.5; }
  h1 { font-size: 30px; margin: 0 0 6px; }
  .details { color: #6b7280; font-size: 14px; margin: 0 0 18px; padding-bottom: 14px; border-bottom: 1px solid #e5e7eb; }
  ol { list-style: none; counter-reset: step; padding: 0; margin: 0; }
  li { counter-increment: step; margin: 0 0 30px; break-inside: avoid; }
  li p { font-size: 17px; font-weight: 500; margin: 0 0 12px; padding-left: 42px; position: relative; min-height: 30px; }
  li p::before { content: counter(step); position: absolute; left: 0; top: -2px; width: 30px; height: 30px; border-radius: 50%; background: rgb(${HIGHLIGHT}); color: #fff; font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid #d1d5db; }
</style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p class="details">${escapeHtml(details)}</p>
  <ol>
${items}
  </ol>
</body>
</html>
`;
}

/** The guide as Markdown that points at picture files saved beside it.
 *  `imageNames[i]` is the file name of step i's picture. */
export function guideMarkdown(
  title: string,
  details: string,
  captions: string[],
  imageNames: string[],
): string {
  const lines: string[] = [`# ${title.trim() || "Untitled guide"}`, "", `_${details}_`, ""];
  captions.forEach((caption, i) => {
    const text = captionOrDefault(caption, i + 1).replace(/\n+/g, " ");
    lines.push(`${i + 1}. ${text}`, "", `   ![Step ${i + 1}](${encodeURI(imageNames[i])})`, "");
  });
  return lines.join("\n");
}

/** A file-name-safe version of a guide title. */
export function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "guide" : slug.slice(0, 60);
}
