import { SheetConfig } from "./tauri";
import { FrameEdits } from "./edits";
import { SheetDraft, SpotlightDraft } from "./prefs";

export type SheetFormat = "png" | "jpeg" | "webp";

export function hexToRgba(
  hex: string,
  alpha = 255,
): [number, number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) || 0;
  const g = parseInt(m.slice(2, 4), 16) || 0;
  const b = parseInt(m.slice(4, 6), 16) || 0;
  return [r, g, b, alpha];
}

export function buildSheetConfig(
  sheet: SheetDraft,
  /** All frame indices in display order (may be user-reordered). */
  orderedIndices: number[],
  edits: FrameEdits,
  trim: { inIdx: number; outIdx: number } | null,
  format: SheetFormat = "png",
  spotlight?: SpotlightDraft | null,
): SheetConfig {
  const includedIndices = orderedIndices.filter(
    (i) => trim === null || (i >= trim.inIdx && i <= trim.outIdx),
  );
  const hasEdits = Object.keys(edits).length > 0;
  return {
    columns: sheet.columnsMode === "auto" ? null : sheet.columns,
    frameStride: 1,
    padding: Math.max(0, sheet.padding),
    background: sheet.bgTransparent
      ? [0, 0, 0, 0]
      : hexToRgba(sheet.bgHex, 255),
    borderWidth: Math.max(0, sheet.borderWidth ?? 0),
    borderColor: [200, 200, 200, 255],
    format,
    maxWidth:
      typeof sheet.maxWidth === "number" && sheet.maxWidth > 0
        ? sheet.maxWidth
        : null,
    showFrameNumber: sheet.showFrameNumber,
    showTimestamp: sheet.showTimestamp,
    annotationPosition: sheet.annotationPosition,
    selectedIndices: includedIndices,
    edits: hasEdits ? edits : null,
    spotlight:
      spotlight?.enabled
        ? { radius: spotlight.radius, dimOpacity: spotlight.dimOpacity }
        : null,
  };
}
