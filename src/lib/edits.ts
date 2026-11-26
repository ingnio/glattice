// Non-destructive, vector-style per-frame edits.
//
// Coordinates and sizes are always in SOURCE-image pixels — same
// coordinate space as the full-resolution frame PNGs. The renderer
// scales as needed when drawing to a display canvas or the sprite
// sheet's resized cell.

export type EditColor = [number, number, number, number]; // rgba 0..255

export type Edit =
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      color: EditColor;
      thickness: number;
      fill: boolean;
    }
  | {
      kind: "ellipse";
      x: number;
      y: number;
      w: number;
      h: number;
      color: EditColor;
      thickness: number;
      fill: boolean;
    }
  | {
      kind: "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: EditColor;
      thickness: number;
    }
  | {
      kind: "freehand";
      points: Array<[number, number]>;
      color: EditColor;
      thickness: number;
    }
  | {
      kind: "text";
      /** Top-left of the text box (source pixels). */
      x: number;
      y: number;
      /** Width/height of the text box. Lines wrap at `w`. */
      w: number;
      h: number;
      text: string;
      color: EditColor;
      sizePx: number;
    }
  | {
      /** A numbered marker: a filled circle with a number in it, for
       *  pointing out steps in order. */
      kind: "step";
      /** Centre of the circle (source pixels). */
      x: number;
      y: number;
      /** The number shown. */
      n: number;
      color: EditColor;
      /** Shared "Size" setting; the circle's radius comes from it via
       *  `stepRadius`. */
      thickness: number;
    }
  | {
      kind: "blur";
      x: number;
      y: number;
      w: number;
      h: number;
      radius: number;
    }
  | {
      kind: "image";
      /** Absolute file-system path — used by Rust at export time. */
      path: string;
      /** Browser URL (convertFileSrc result) — used for canvas rendering. */
      src: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** Original dimensions — kept so callers can enforce aspect ratio. */
      naturalW: number;
      naturalH: number;
    }
  | {
      /**
       * Heuristic content-simplify. Downsamples the region into blocks,
       * detects foreground via adaptive local-bg threshold, merges
       * adjacent blocks into components, and renders each as a pill
       * (or a circle for round-ish shapes).
       *
       * The three tuning fields below are optional; they default to
       * the "reasonable for code screenshots" values in `paintEdits`.
       */
      kind: "simplify";
      x: number;
      y: number;
      w: number;
      h: number;
      /** Pixels per block. Smaller = finer detail, larger = chunkier. */
      blockSize?: number;
      /** Luminance delta (on the block plane) for a block to count as
       *  foreground. Lower = more sensitive. */
      threshold?: number;
      /** Horizontal dilation radius (in BLOCK units) used to merge
       *  letters into words and words into lines. */
      merge?: number;
      /** Bbox pad in BLOCK units around each detected component. */
      padding?: number;
      /** Cap (in source pixels) on the rounded-rect corner radius —
       *  0 = sharp corners, large = pill / capsule shape. */
      roundness?: number;
    };

export type EditTool =
  | "select"
  | "blur"
  | "simplify"
  | "rect"
  | "ellipse"
  | "arrow"
  | "freehand"
  | "text"
  | "step";

/** All edits, keyed by frame index. */
export type FrameEdits = Record<number, Edit[]>;

/** Default palette for the color picker — fits the UI's accent tones. */
export const EDIT_PALETTE: EditColor[] = [
  [250, 204, 21, 255],   // amber (matches the marching-ants accent)
  [239, 68, 68, 255],    // red
  [34, 197, 94, 255],    // green
  [59, 130, 246, 255],   // blue
  [168, 85, 247, 255],   // purple
  [255, 255, 255, 255],  // white
  [17, 24, 39, 255],     // near-black
];

/** Radius of a step marker for a given Size setting, in source pixels.
 *  Mirrored by `step_radius` in src-tauri/src/edits.rs. */
export function stepRadius(thickness: number): number {
  return 8 + thickness * 3;
}

/** The number a new step marker gets: one more than the highest on the
 *  frame, so deleting the last one and adding again reuses its number. */
export function nextStepNumber(frameEdits: Edit[]): number {
  let max = 0;
  for (const e of frameEdits) if (e.kind === "step" && e.n > max) max = e.n;
  return max + 1;
}

export function colorToCss(c: EditColor): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] / 255})`;
}

/** Deep-ish clone of a single edit so we can safely mutate during drag. */
export function cloneEdit(edit: Edit): Edit {
  if (edit.kind === "freehand") {
    return { ...edit, points: edit.points.map((p) => [p[0], p[1]] as [number, number]) };
  }
  return { ...edit };
}

/** Move one edit by (dx, dy) source pixels. */
export function shiftEdit(edit: Edit, dx: number, dy: number): Edit {
  if (edit.kind === "arrow") {
    return {
      ...edit,
      x1: edit.x1 + dx,
      y1: edit.y1 + dy,
      x2: edit.x2 + dx,
      y2: edit.y2 + dy,
    };
  }
  if (edit.kind === "freehand") {
    return {
      ...edit,
      points: edit.points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]),
    };
  }
  return { ...edit, x: edit.x + dx, y: edit.y + dy };
}

/** Move every edit on every frame, e.g. after the frames are cropped. */
export function shiftAllEdits(all: FrameEdits, dx: number, dy: number): FrameEdits {
  const next: FrameEdits = {};
  for (const [frame, list] of Object.entries(all)) {
    next[Number(frame)] = list.map((e) => shiftEdit(e, dx, dy));
  }
  return next;
}

export function getFrameEdits(all: FrameEdits, frame: number): Edit[] {
  return all[frame] ?? [];
}

export function setFrameEdits(
  all: FrameEdits,
  frame: number,
  edits: Edit[],
): FrameEdits {
  const next = { ...all };
  if (edits.length === 0) delete next[frame];
  else next[frame] = edits;
  return next;
}
