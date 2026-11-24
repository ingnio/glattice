// The trim: which stretch of the clip is kept.
//
// A trim is a range of POSITIONS in the frame order as it is displayed
// (after any reordering, with deleted frames gone), both ends inclusive.
// It is deliberately not expressed in original frame indices: once a
// frame has been deleted, inserted or moved, indices stop being
// contiguous and stop matching what the scrubber shows.

export interface TrimRange {
  /** Position of the first kept frame. */
  inPos: number;
  /** Position of the last kept frame. */
  outPos: number;
}

/** The frames a trim keeps, in display order. `frames` must be the
 *  full displayed order the trim was made against. */
export function applyTrim<T>(frames: T[], trim: TrimRange | null): T[] {
  if (trim === null) return frames;
  const start = Math.max(0, Math.min(trim.inPos, frames.length));
  const end = Math.max(start, Math.min(trim.outPos + 1, frames.length));
  return frames.slice(start, end);
}

/** Carry a trim across a change to the frame order (frames deleted,
 *  restored, inserted or dragged to a new place), so it keeps covering
 *  the same frames instead of the same slots.
 *
 *  `prev` and `next` are the orders before and after, as lists of frame
 *  ids. The new range runs from the first to the last surviving frame of
 *  the old range. An end that wasn't trimmed stays untrimmed, so a frame
 *  added at an open end is kept. Returns `null` when nothing is trimmed
 *  any more (including when every kept frame is gone).
 *
 *  `moved` is the id of a frame the user dragged to a new place. Only
 *  that frame can change sides: dropped between the trim marks it is
 *  kept, dropped outside them it is cut, and every other frame stays as
 *  it was. Dropped right on a mark, it stays on the side it came from. */
export function remapTrim(
  prev: number[],
  next: number[],
  trim: TrimRange | null,
  moved?: number,
): TrimRange | null {
  if (trim === null) return null;
  if (next.length === 0) return null;

  const kept = new Set(applyTrim(prev, trim));
  let first = -1;
  let last = -1;
  next.forEach((id, pos) => {
    if (!kept.has(id) || id === moved) return;
    if (first < 0) first = pos;
    last = pos;
  });
  if (moved !== undefined && kept.has(moved)) {
    const at = next.indexOf(moved);
    if (first < 0) {
      // It was the only kept frame: the trim goes where it went.
      first = at;
      last = at;
    } else if (at === first - 1) {
      first = at;
    } else if (at === last + 1) {
      last = at;
    }
  }
  if (first < 0) return null;

  const startWasOpen = trim.inPos <= 0;
  const endWasOpen = trim.outPos >= prev.length - 1;
  const inPos = startWasOpen ? 0 : first;
  const outPos = endWasOpen ? next.length - 1 : last;
  if (inPos <= 0 && outPos >= next.length - 1) return null;
  return { inPos, outPos };
}
