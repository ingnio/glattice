import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCtrlWheelZoom } from "./lib/useCtrlWheelZoom";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { convertFileSrc, FrameThumb, InputEvent } from "./lib/tauri";
import {
  Edit,
  EditColor,
  EditTool,
  EDIT_PALETTE,
  FrameEdits,
  colorToCss,
  getFrameEdits,
  setFrameEdits,
} from "./lib/edits";
import { drawClicks, drawCursor, drawKeys, drawSpotlight, paintEdit } from "./lib/paintEdits";
import type { SimplifyDraft, SpotlightDraft } from "./lib/prefs";
import {
  IconArrow,
  IconBack,
  IconBlur,
  IconCircleTool,
  IconCopyAll,
  IconCursor,
  IconNext,
  IconPen,
  IconPrev,
  IconRectTool,
  IconRestore,
  IconSave,
  IconSimplify,
  IconText,
  IconTrash,
  IconUndo,
} from "./icons";

interface Props {
  thumbs: FrameThumb[];
  index: number;
  excluded: Set<number>;
  edits: FrameEdits;
  inputEvents: InputEvent[];
  simplify: SimplifyDraft;
  spotlight: SpotlightDraft;
  onBack: () => void;
  onNavigate: (index: number) => void;
  onToggle: (index: number) => void;
  onEditsChange: (edits: FrameEdits) => void;
  onSimplifyChange: (update: Partial<SimplifyDraft>) => void;
  compactNavButton?: React.ReactNode;
}

export default function Zoom({
  thumbs,
  index,
  excluded,
  edits,
  inputEvents,
  simplify,
  spotlight,
  onBack,
  onNavigate,
  onToggle,
  onEditsChange,
  onSimplifyChange,
  compactNavButton,
}: Props) {
  const pos = thumbs.findIndex((t) => t.index === index);
  const current = pos >= 0 ? thumbs[pos] : null;
  const isExcluded = current ? excluded.has(current.index) : false;

  const [tool, setTool] = useState<EditTool>("select");
  const [color, setColor] = useState<EditColor>(EDIT_PALETTE[0]);
  const [thickness, setThickness] = useState<number>(6);
  const [blurStrength, setBlurStrength] = useState<number>(12);
  // Simplify defaults come from persisted prefs so the user's last
  // tuned values are remembered across sessions.
  const simplifyBlock = simplify.blockSize;
  const simplifyThreshold = simplify.threshold;
  const simplifyMerge = simplify.merge;
  const simplifyPadding = simplify.padding;
  const simplifyRoundness = simplify.roundness;
  const [drafting, setDrafting] = useState<Edit | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [previewEdit, setPreviewEdit] = useState<{
    idx: number;
    edit: Edit;
  } | null>(null);
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);

  const applyZoom = useCallback((z: number) => {
    const img = imgRef.current;
    if (!img) return;
    if (z === 1) {
      img.style.width = "";
      img.style.height = "";
      img.style.maxWidth = "";
      img.style.maxHeight = "";
      baseSizeRef.current = null;
    } else {
      if (!baseSizeRef.current) {
        const r = img.getBoundingClientRect();
        baseSizeRef.current = { w: r.width, h: r.height };
      }
      const { w, h } = baseSizeRef.current;
      img.style.width = `${w * z}px`;
      img.style.height = `${h * z}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
    }
    // The ResizeObserver on imgRef will fire and re-pin the canvas.
  }, []);

  const resetZoom = useCtrlWheelZoom(stageRef, applyZoom, zoomRef);
  const draftingRef = useRef<Edit | null>(null);
  draftingRef.current = drafting;
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const shiftRef = useRef(false);
  const selectOpRef = useRef<{
    kind: "move" | "nw" | "ne" | "sw" | "se" | "p1" | "p2";
    original: Edit;
    startPt: { x: number; y: number };
    idx: number;
  } | null>(null);
  const previewEditRef = useRef<{ idx: number; edit: Edit } | null>(null);
  previewEditRef.current = previewEdit;

  const frameEdits = current ? getFrameEdits(edits, current.index) : [];

  // Drop any selection or drag op when the frame or active tool
  // changes — the selected index points into a different frame's
  // edit list after navigation, so leaving it set would paint the
  // wrong handles.
  useEffect(() => {
    setSelectedIdx(null);
    selectOpRef.current = null;
    setPreviewEdit(null);
    setEditingTextIdx(null);
  }, [current?.index, tool]);

  // Keyboard shortcuts. Delete removes the selected edit when one is
  // focused, otherwise falls through to toggling frame exclude.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editingText = tag === "input" || tag === "textarea";
      if (editingText) return;
      if (e.key === "Escape") {
        if (drafting) setDrafting(null);
        else if (selectedIdx !== null) setSelectedIdx(null);
        else onBack();
      } else if (e.key === "ArrowLeft" && pos > 0) {
        setSelectedIdx(null);
        onNavigate(thumbs[pos - 1].index);
      } else if (e.key === "ArrowRight" && pos < thumbs.length - 1) {
        setSelectedIdx(null);
        onNavigate(thumbs[pos + 1].index);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (current && selectedIdx !== null && selectedIdx < frameEdits.length) {
          const next = frameEdits.filter((_, i) => i !== selectedIdx);
          onEditsChange(setFrameEdits(edits, current.index, next));
          setSelectedIdx(null);
        } else if (current) {
          onToggle(current.index);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (current && frameEdits.length > 0) {
          const next = frameEdits.slice(0, -1);
          onEditsChange(setFrameEdits(edits, current.index, next));
          if (selectedIdx !== null && selectedIdx >= next.length) {
            setSelectedIdx(null);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    pos,
    thumbs,
    onBack,
    onNavigate,
    onToggle,
    current,
    drafting,
    edits,
    frameEdits,
    onEditsChange,
    selectedIdx,
  ]);

  // ——— Canvas sizing + repaint ———
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
  }, []);

  // Pin the canvas's display rect to the img's actual bounding rect.
  // Without this, the canvas's CSS-based "inset: 0" sizing can drift
  // by a sub-pixel from the img during a window resize, and the
  // simplify pills end up offset from the underlying image features.
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!img || !canvas || !surface) return;
    const sync = () => {
      const ir = img.getBoundingClientRect();
      const sr = surface.getBoundingClientRect();
      if (ir.width === 0 || ir.height === 0) return;
      canvas.style.width = `${ir.width}px`;
      canvas.style.height = `${ir.height}px`;
      canvas.style.left = `${ir.left - sr.left}px`;
      canvas.style.top = `${ir.top - sr.top}px`;
      canvas.style.right = "auto";
      canvas.style.bottom = "auto";
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(img);
    ro.observe(surface);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [imgSize]);

  // Repaint whenever the set of edits, the draft, or the image changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render frame edits, swapping in the live drag preview for the
    // selected index so the user sees their move/resize in real time
    // without committing to state on every pointer move. Skip the edit
    // that's being text-edited — the overlay <textarea> shows its text
    // live, and painting a duplicate would ghost behind the caret.
    const base = frameEdits.map((e, i) =>
      previewEdit && previewEdit.idx === i ? previewEdit.edit : e,
    );
    const all = drafting ? [...base, drafting] : base;
    for (let i = 0; i < all.length; i++) {
      if (i === editingTextIdx) continue;
      const isDraft = drafting !== null && i === all.length - 1;
      paintEdit(ctx, img, all[i], isDraft ? { isDraft: true } : undefined);
    }

    // Re-blit the recording cursor on top of any edits so simplify
    // pills (or any other edit) can't bury it.
    if (current?.cursor) {
      drawCursor(ctx, current.cursor.x, current.cursor.y);
    }

    // Overlay click rings + recent-keys chips. Same after-edits order
    // as the cursor, so they ride on top of any simplify / blur / etc.
    if (current && inputEvents.length > 0) {
      drawClicks(
        ctx,
        inputEvents,
        current.elapsedMs,
        canvas.width,
        canvas.height,
      );
      drawKeys(
        ctx,
        inputEvents,
        current.elapsedMs,
        canvas.width,
        canvas.height,
      );
    }

    // Spotlight vignette — applied on top of edits + cursor so the dim
    // layer doesn't bury the cursor glyph or click rings.
    if (spotlight.enabled && current?.cursor) {
      drawSpotlight(ctx, current.cursor.x, current.cursor.y, spotlight.radius, spotlight.dimOpacity);
    }

    // Paint selection outline whenever something is selected, regardless
    // of which tool is active. After drawing, the new edit stays selected
    // so the toolbar can modify it — the outline makes that state visible.
    if (selectedIdx !== null && selectedIdx < base.length && !drafting) {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width > 0 ? canvas.width / rect.width : 1;
      paintSelection(ctx, base[selectedIdx], scale);
    }
  }, [
    frameEdits,
    drafting,
    imgSize,
    selectedIdx,
    tool,
    previewEdit,
    editingTextIdx,
    current?.cursor,
    current?.elapsedMs,
    inputEvents,
    spotlight,
  ]);

  // ——— Coordinate mapping ———
  const toSource = useCallback((evt: React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = ((evt.clientX - rect.left) * canvas.width) / Math.max(rect.width, 1);
    const sy = ((evt.clientY - rect.top) * canvas.height) / Math.max(rect.height, 1);
    return { x: sx, y: sy };
  }, []);

  const commitEdit = useCallback(
    (e: Edit) => {
      if (!current) return;
      const next = [...frameEdits, e];
      onEditsChange(setFrameEdits(edits, current.index, next));
    },
    [current, edits, frameEdits, onEditsChange],
  );

  // Square-lock helper. When `square` is true, the larger of |dx|/|dy|
  // sets both sides and the box grows in whatever direction the cursor
  // is moving. Mirrors the shift-to-square behaviour in the region
  // overlay.
  const boxFromStart = (
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    square: boolean,
  ): { x: number; y: number; w: number; h: number } => {
    let dx = ex - sx;
    let dy = ey - sy;
    if (square) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -side : side;
      dy = dy < 0 ? -side : side;
    }
    return {
      x: Math.min(sx, sx + dx),
      y: Math.min(sy, sy + dy),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
  };

  const onPointerDown = useCallback(
    (evt: React.PointerEvent) => {
      if (evt.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const p = toSource(evt);
      startRef.current = { x: p.x, y: p.y };
      lastPointRef.current = { x: p.x, y: p.y };
      shiftRef.current = evt.shiftKey;

      if (tool === "select") {
        const rect = canvas.getBoundingClientRect();
        const scale = rect.width > 0 ? canvas.width / rect.width : 1;
        const handleTol = HANDLE_DISPLAY_SIZE * scale * 0.75;

        // Prefer a handle hit on the currently-selected edit — so a
        // click on a corner always resizes even if the corner happens
        // to sit over another edit.
        if (selectedIdx !== null && selectedIdx < frameEdits.length) {
          const sel = frameEdits[selectedIdx];
          const handle = hitHandle(sel, p.x, p.y, handleTol);
          if (handle) {
            canvas.setPointerCapture(evt.pointerId);
            selectOpRef.current = {
              kind: handle,
              original: cloneEditShallow(sel),
              startPt: p,
              idx: selectedIdx,
            };
            return;
          }
        }

        // Otherwise: hit-test edits top-down. Clicking an edit selects
        // it and starts a move; clicking empty space deselects.
        const hitTol = Math.max(6, 10 * scale);
        const idx = hitTestEdits(frameEdits, p.x, p.y, hitTol);
        if (idx !== null) {
          setSelectedIdx(idx);
          canvas.setPointerCapture(evt.pointerId);
          selectOpRef.current = {
            kind: "move",
            original: cloneEditShallow(frameEdits[idx]),
            startPt: p,
            idx,
          };
        } else {
          setSelectedIdx(null);
        }
        return;
      }

      canvas.setPointerCapture(evt.pointerId);
      // Starting a new draw always auto-deselects the previous edit so
      // draw → draw gives two independent edits, not an accidental patch.
      setSelectedIdx(null);
      let next: Edit | null = null;
      switch (tool) {
        case "rect":
          next = { kind: "rect", x: p.x, y: p.y, w: 0, h: 0, color, thickness, fill: false };
          break;
        case "ellipse":
          next = { kind: "ellipse", x: p.x, y: p.y, w: 0, h: 0, color, thickness, fill: false };
          break;
        case "arrow":
          next = { kind: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, thickness };
          break;
        case "freehand":
          next = { kind: "freehand", points: [[p.x, p.y]], color, thickness };
          break;
        case "blur":
          next = {
            kind: "blur",
            x: p.x,
            y: p.y,
            w: 0,
            h: 0,
            radius: blurStrength,
          };
          break;
        case "simplify":
          next = {
            kind: "simplify",
            x: p.x,
            y: p.y,
            w: 0,
            h: 0,
            blockSize: simplifyBlock,
            threshold: simplifyThreshold,
            merge: simplifyMerge,
            padding: simplifyPadding,
            roundness: simplifyRoundness,
          };
          break;
        case "text":
          next = {
            kind: "text",
            x: p.x,
            y: p.y,
            w: 0,
            h: 0,
            text: "",
            color,
            sizePx: Math.max(12, thickness * 6),
          };
          break;
      }
      if (next) setDrafting(next);
    },
    [tool, color, thickness, blurStrength, toSource, selectedIdx, frameEdits],
  );

  const onPointerMove = useCallback(
    (evt: React.PointerEvent) => {
      const p = toSource(evt);
      lastPointRef.current = p;
      shiftRef.current = evt.shiftKey;

      const sel = selectOpRef.current;
      if (sel) {
        const dx = p.x - sel.startPt.x;
        const dy = p.y - sel.startPt.y;
        const next = applySelectOp(sel.original, sel.kind, dx, dy, p, evt.shiftKey);
        setPreviewEdit({ idx: sel.idx, edit: next });
        return;
      }

      const d = draftingRef.current;
      if (!d) return;
      const start = startRef.current;
      if (!start) return;
      if (
        d.kind === "rect" ||
        d.kind === "ellipse" ||
        d.kind === "blur" ||
        d.kind === "simplify" ||
        d.kind === "text"
      ) {
        const box = boxFromStart(start.x, start.y, p.x, p.y, evt.shiftKey);
        setDrafting({ ...d, ...box } as Edit);
      } else if (d.kind === "arrow") {
        setDrafting({ ...d, x2: p.x, y2: p.y });
      } else if (d.kind === "freehand") {
        // Skip near-duplicate samples so the stored polyline stays small.
        const last = d.points[d.points.length - 1];
        const dx = p.x - last[0];
        const dy = p.y - last[1];
        if (dx * dx + dy * dy > 2) {
          setDrafting({ ...d, points: [...d.points, [p.x, p.y]] });
        }
      }
    },
    [toSource],
  );

  const onPointerUp = useCallback(() => {
    startRef.current = null;
    lastPointRef.current = null;

    // If we were dragging a selection, commit the preview back into
    // the edit list.
    const sel = selectOpRef.current;
    const preview = previewEditRef.current;
    if (sel) {
      selectOpRef.current = null;
      if (current && preview && preview.idx < frameEdits.length) {
        const next = frameEdits.map((e, i) => (i === preview.idx ? preview.edit : e));
        onEditsChange(setFrameEdits(edits, current.index, next));
      }
      setPreviewEdit(null);
      return;
    }

    const d = draftingRef.current;
    if (!d) {
      setDrafting(null);
      return;
    }
    // A text box is allowed to be tiny on release — the user might have
    // intended to click-place a small label. Give it a sensible minimum.
    if (d.kind === "text") {
      const sizePx = d.sizePx;
      const minW = Math.max(120, sizePx * 5);
      const minH = Math.max(sizePx * 1.4, 24);
      const finalEdit: Edit = {
        ...d,
        w: Math.max(d.w, minW),
        h: Math.max(d.h, minH),
      };
      if (current) {
        const newIdx = frameEdits.length;
        onEditsChange(
          setFrameEdits(edits, current.index, [...frameEdits, finalEdit]),
        );
        setEditingTextIdx(newIdx);
        setSelectedIdx(newIdx);
      }
      setDrafting(null);
      return;
    }
    const bigEnough =
      d.kind === "arrow"
        ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 6
        : d.kind === "freehand"
          ? d.points.length > 1
          : (d as { w?: number; h?: number }).w! > 3 &&
            (d as { w?: number; h?: number }).h! > 3;
    if (bigEnough) {
      const newIdx = frameEdits.length;
      commitEdit(d);
      setSelectedIdx(newIdx);
    }
    setDrafting(null);
  }, [commitEdit, current, edits, frameEdits, onEditsChange]);

  // Track shift globally so toggling it mid-drag reshapes the draft
  // (new edit) OR the in-flight resize (selected edit) even when the
  // pointer isn't moving.
  useEffect(() => {
    const regen = () => {
      const p = lastPointRef.current;
      if (!p) return;
      const sel = selectOpRef.current;
      if (sel) {
        const dx = p.x - sel.startPt.x;
        const dy = p.y - sel.startPt.y;
        const next = applySelectOp(
          sel.original,
          sel.kind,
          dx,
          dy,
          p,
          shiftRef.current,
        );
        setPreviewEdit({ idx: sel.idx, edit: next });
        return;
      }
      const d = draftingRef.current;
      const start = startRef.current;
      if (!d || !start) return;
      if (
        d.kind === "rect" ||
        d.kind === "ellipse" ||
        d.kind === "blur" ||
        d.kind === "simplify" ||
        d.kind === "text"
      ) {
        const box = boxFromStart(start.x, start.y, p.x, p.y, shiftRef.current);
        setDrafting({ ...d, ...box } as Edit);
      }
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift" && !shiftRef.current) {
        shiftRef.current = true;
        regen();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift" && shiftRef.current) {
        shiftRef.current = false;
        regen();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // Focus the text box whenever we enter text-edit mode.
  useEffect(() => {
    if (editingTextIdx !== null && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [editingTextIdx]);

  const updateEditingText = (value: string) => {
    if (!current || editingTextIdx === null) return;
    const list = frameEdits.map((e, i) =>
      i === editingTextIdx && e.kind === "text" ? { ...e, text: value } : e,
    );
    onEditsChange(setFrameEdits(edits, current.index, list));
  };

  const finishEditingText = () => {
    if (!current || editingTextIdx === null) {
      setEditingTextIdx(null);
      return;
    }
    const cur = frameEdits[editingTextIdx];
    if (!cur || cur.kind !== "text" || cur.text.trim() === "") {
      // Empty text boxes serve no purpose — drop them on commit.
      const list = frameEdits.filter((_, i) => i !== editingTextIdx);
      onEditsChange(setFrameEdits(edits, current.index, list));
    }
    setEditingTextIdx(null);
  };

  const handleUndo = () => {
    if (!current || frameEdits.length === 0) return;
    onEditsChange(
      setFrameEdits(edits, current.index, frameEdits.slice(0, -1)),
    );
  };

  const handleClear = () => {
    if (!current) return;
    onEditsChange(setFrameEdits(edits, current.index, []));
  };

  const handleApplyToAll = () => {
    if (!current || frameEdits.length === 0) return;
    const confirm = window.confirm(
      `Apply ${frameEdits.length} edit(s) to all ${thumbs.length} frames? ` +
        "This will replace any existing edits on other frames.",
    );
    if (!confirm) return;
    const next: FrameEdits = {};
    for (const t of thumbs) next[t.index] = frameEdits.map((e) => cloneEditShallow(e));
    onEditsChange(next);
  };

  const [saving, setSaving] = useState(false);

  const saveFrame = useCallback(async () => {
    if (!current || !imgSize) return;
    const img = imgRef.current;
    if (!img) return;
    const target = await saveDialog({
      defaultPath: `frame-${current.index + 1}.png`,
      filters: [
        { name: "PNG image", extensions: ["png"] },
        { name: "JPEG image", extensions: ["jpg", "jpeg"] },
        { name: "WebP image", extensions: ["webp"] },
      ],
    });
    if (!target) return;
    setSaving(true);
    try {
      const offscreen = new OffscreenCanvas(imgSize.w, imgSize.h);
      const ctx = offscreen.getContext("2d") as unknown as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      for (const e of frameEdits) paintEdit(ctx, img, e);
      if (current.cursor) drawCursor(ctx, current.cursor.x, current.cursor.y);
      if (inputEvents.length > 0) {
        drawClicks(ctx, inputEvents, current.elapsedMs, imgSize.w, imgSize.h);
        drawKeys(ctx, inputEvents, current.elapsedMs, imgSize.w, imgSize.h);
      }
      if (spotlight.enabled && current.cursor) {
        drawSpotlight(ctx, current.cursor.x, current.cursor.y, spotlight.radius, spotlight.dimOpacity);
      }
      const ext = target.split(".").pop()?.toLowerCase() ?? "png";
      const mime =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      const blob = await offscreen.convertToBlob({ type: mime, quality: 0.92 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeFile(target, bytes);
    } finally {
      setSaving(false);
    }
  }, [current, imgSize, frameEdits, inputEvents, spotlight]);

  const srcUrl = useMemo(
    () => (current ? convertFileSrc(current.path) : ""),
    [current],
  );

  // ——— Active-edit metadata for the toolbar ————————————————————————
  //
  // If the select tool has something picked, the color/size/strength
  // controls operate on that selection. Otherwise they set defaults for
  // whichever drawing tool is active. Controls the tool/selection can't
  // use (e.g. color for blur) stay hidden.
  // selectedEdit is live regardless of which tool is active — after
  // drawing, the new edit stays selected so the user can tweak its
  // properties without switching to the select tool first.
  const selectedEdit =
    selectedIdx !== null && selectedIdx < frameEdits.length
      ? frameEdits[selectedIdx]
      : null;
  const activeKind: Edit["kind"] | null = selectedEdit
    ? selectedEdit.kind
    : tool === "select"
      ? null
      : (tool as Edit["kind"]);
  const hasColor =
    activeKind !== null && activeKind !== "blur" && activeKind !== "simplify";
  const hasThickness =
    activeKind !== null && activeKind !== "blur" && activeKind !== "simplify";
  const hasStrength = activeKind === "blur";
  const hasSimplify = activeKind === "simplify";

  const displayedBlock =
    selectedEdit && selectedEdit.kind === "simplify"
      ? (selectedEdit.blockSize ?? simplifyBlock)
      : simplifyBlock;
  const displayedThreshold =
    selectedEdit && selectedEdit.kind === "simplify"
      ? (selectedEdit.threshold ?? simplifyThreshold)
      : simplifyThreshold;
  const displayedMerge =
    selectedEdit && selectedEdit.kind === "simplify"
      ? (selectedEdit.merge ?? simplifyMerge)
      : simplifyMerge;
  const displayedPadding =
    selectedEdit && selectedEdit.kind === "simplify"
      ? (selectedEdit.padding ?? simplifyPadding)
      : simplifyPadding;
  const displayedRoundness =
    selectedEdit && selectedEdit.kind === "simplify"
      ? (selectedEdit.roundness ?? simplifyRoundness)
      : simplifyRoundness;


  const displayedColor: EditColor =
    selectedEdit && "color" in selectedEdit ? selectedEdit.color : color;
  const displayedThickness = selectedEdit
    ? selectedEdit.kind === "text"
      ? Math.max(2, Math.min(24, Math.round(selectedEdit.sizePx / 6)))
      : "thickness" in selectedEdit
        ? selectedEdit.thickness
        : thickness
    : thickness;
  const displayedStrength =
    selectedEdit && selectedEdit.kind === "blur"
      ? selectedEdit.radius
      : blurStrength;

  const updateSelectedEdit = (patch: Partial<Edit>) => {
    if (!current || selectedIdx === null || !selectedEdit) return;
    const next = { ...selectedEdit, ...patch } as Edit;
    const list = frameEdits.map((e, i) => (i === selectedIdx ? next : e));
    onEditsChange(setFrameEdits(edits, current.index, list));
  };

  const onColorPick = (c: EditColor) => {
    if (selectedEdit && "color" in selectedEdit) {
      updateSelectedEdit({ color: c } as Partial<Edit>);
    } else {
      setColor(c);
    }
  };

  const onThicknessChange = (t: number) => {
    if (selectedEdit) {
      if (selectedEdit.kind === "text") {
        updateSelectedEdit({ sizePx: Math.max(12, t * 6) } as Partial<Edit>);
      } else if ("thickness" in selectedEdit) {
        updateSelectedEdit({ thickness: t } as Partial<Edit>);
      }
    } else {
      setThickness(t);
    }
  };

  const onStrengthChange = (r: number) => {
    if (selectedEdit && selectedEdit.kind === "blur") {
      updateSelectedEdit({ radius: r } as Partial<Edit>);
    } else {
      setBlurStrength(r);
    }
  };

  const onCompactSliderChange = (
    field: "blockSize" | "threshold" | "merge" | "padding" | "roundness",
    value: number,
  ) => {
    // Always persist the new default so the next new simplify region
    // inherits the last-tuned value (also persisted across sessions
    // via the preferences store).
    onSimplifyChange({ [field]: value } as Partial<SimplifyDraft>);
    // If there's an edit selected, also patch it in place so tuning
    // live-edits the bars.
    if (selectedEdit && selectedEdit.kind === "simplify") {
      updateSelectedEdit({ [field]: value } as Partial<Edit>);
    }
  };

  if (!current) {
    return (
      <div className="zoom">
        <div className="zoom__bar">
          <div className="muted">Frame not found</div>
        </div>
      </div>
    );
  }

  const canPrev = pos > 0;
  const canNext = pos < thumbs.length - 1;

  const toolBtn = (key: EditTool, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      key={key}
      className={`editor-tool ${tool === key ? "is-active" : ""}`}
      title={title}
      onClick={() => { setTool(key); setSelectedIdx(null); }}
    >
      {icon}
    </button>
  );

  return (
    <div className="zoom">
      <div className="zoom__bar">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          title="Back to frames"
        >
          <IconBack size={18} />
        </button>
        <span className="zoom__bar__sep" />
        <div className="editor-bar__group">
          {toolBtn("select", <IconCursor size={18} />, "Select / view")}
          {toolBtn("rect", <IconRectTool size={18} />, "Rectangle")}
          {toolBtn("ellipse", <IconCircleTool size={18} />, "Ellipse")}
          {toolBtn("arrow", <IconArrow size={18} />, "Arrow")}
          {toolBtn("freehand", <IconPen size={18} />, "Freehand")}
          {toolBtn("text", <IconText size={18} />, "Text")}
          {toolBtn("blur", <IconBlur size={18} />, "Blur region")}
          {toolBtn("simplify", <IconSimplify size={18} />, "Simplify content")}
        </div>

        <div className="editor-bar__group" style={{ marginLeft: "auto" }}>
          <span className="zoom__bar__info">
            <span>Frame {current.index + 1}</span>
            <span className="muted">/ {thumbs.length}</span>
            {isExcluded && <span className="tag tag--excluded">excluded</span>}
            {frameEdits.length > 0 && (
              <span className="tag tag--edited">
                {frameEdits.length} edit{frameEdits.length > 1 ? "s" : ""}
              </span>
            )}
          </span>
          <span className="zoom__bar__sep" />
          <button type="button" className="icon-btn" onClick={handleUndo} disabled={frameEdits.length === 0} title="Undo (Ctrl+Z)">
            <IconUndo size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={handleClear} disabled={frameEdits.length === 0} title="Clear all edits">
            <IconTrash size={18} />
          </button>
          <button type="button" className="icon-btn" onClick={handleApplyToAll} disabled={frameEdits.length === 0} title="Apply to all frames">
            <IconCopyAll size={18} />
          </button>
          <span className="zoom__bar__sep" />
          <button
            type="button"
            className={`icon-btn ${isExcluded ? "icon-btn--active" : ""}`}
            onClick={() => onToggle(current.index)}
            title={isExcluded ? "Include frame" : "Exclude frame"}
          >
            {isExcluded ? <IconRestore size={18} /> : <IconTrash size={18} />}
          </button>
          <span className="zoom__bar__sep" />
          <button
            type="button"
            className={`icon-btn ${saving ? "icon-btn--busy" : ""}`}
            onClick={saveFrame}
            disabled={saving}
            title="Save frame as image"
          >
            <IconSave size={18} />
          </button>
          {compactNavButton}
        </div>
      </div>

      {(hasColor || hasThickness || hasStrength || hasSimplify) && (
        <div className="editor-props">
          {hasColor && (
            <div className="editor-bar__group">
              {EDIT_PALETTE.map((c, i) => (
                <button
                  type="button"
                  key={i}
                  className={`editor-swatch ${displayedColor.join(",") === c.join(",") ? "is-active" : ""}`}
                  style={{ background: colorToCss(c) }}
                  onClick={() => onColorPick(c)}
                  title="Color"
                />
              ))}
            </div>
          )}
          {hasThickness && (
            <CompactSlider label="Size" value={displayedThickness} min={2} max={24} step={1} onChange={onThicknessChange} title="Stroke / text size in source pixels" />
          )}
          {hasStrength && (
            <CompactSlider label="Strength" value={displayedStrength} min={2} max={40} step={1} onChange={onStrengthChange} title="Blur radius" />
          )}
          {hasSimplify && (
            <div className="simplify-sliders">
              <CompactSlider label="Detail" value={displayedBlock} min={1} max={12} step={1} onChange={(v) => onCompactSliderChange("blockSize", v)} title="Block size in source pixels" />
              <CompactSlider label="Palette" value={displayedThreshold} min={4} max={50} step={1} onChange={(v) => onCompactSliderChange("threshold", v)} title="Number of distinct colors" />
              <CompactSlider label="Merge" value={displayedMerge} min={0} max={16} step={1} onChange={(v) => onCompactSliderChange("merge", v)} title="Horizontal merge radius" />
              <CompactSlider label="Padding" value={displayedPadding} min={0} max={8} step={0.25} onChange={(v) => onCompactSliderChange("padding", v)} title="Bbox padding" />
              <CompactSlider label="Roundness" value={displayedRoundness} min={0} max={32} step={1} onChange={(v) => onCompactSliderChange("roundness", v)} title="Corner radius" />
            </div>
          )}
        </div>
      )}

      <div className="zoom__stage" ref={stageRef}>
        <div className="editor-surface" ref={surfaceRef}>
          <img
            ref={imgRef}
            className="zoom__img editor-img"
            src={srcUrl}
            alt={`Frame ${current.index + 1}`}
            onLoad={onImgLoad}
            onDoubleClick={resetZoom}
            draggable={false}
            crossOrigin="anonymous"
          />
          <canvas
            ref={canvasRef}
            className={`editor-canvas editor-canvas--${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(evt) => {
              if (tool !== "select") return;
              const canvas = canvasRef.current;
              if (!canvas) return;
              const rect = canvas.getBoundingClientRect();
              const sx = ((evt.clientX - rect.left) * canvas.width) / Math.max(rect.width, 1);
              const sy = ((evt.clientY - rect.top) * canvas.height) / Math.max(rect.height, 1);
              const scale = rect.width > 0 ? canvas.width / rect.width : 1;
              const hitTol = Math.max(6, 10 * scale);
              const idx = hitTestEdits(frameEdits, sx, sy, hitTol);
              if (idx !== null && frameEdits[idx].kind === "text") {
                setSelectedIdx(idx);
                setEditingTextIdx(idx);
              }
            }}
          />
          {editingTextIdx !== null &&
            (() => {
              const edit = frameEdits[editingTextIdx];
              if (!edit || edit.kind !== "text") return null;
              const canvas = canvasRef.current;
              const surface = surfaceRef.current;
              if (!canvas || !surface) return null;
              const cRect = canvas.getBoundingClientRect();
              const sRect = surface.getBoundingClientRect();
              const sx = canvas.width > 0 ? cRect.width / canvas.width : 1;
              const sy = canvas.height > 0 ? cRect.height / canvas.height : 1;
              // Origin offset accounts for any space between the
              // surface's top-left and the canvas's top-left (the
              // ResizeObserver pins canvas to the img exactly, so the
              // canvas may sit a few px inside the surface).
              const ox = cRect.left - sRect.left;
              const oy = cRect.top - sRect.top;
              return (
                <textarea
                  ref={textAreaRef}
                  className="editor-text-area"
                  style={{
                    left: ox + edit.x * sx,
                    top: oy + edit.y * sy,
                    width: edit.w * sx,
                    height: edit.h * sy,
                    fontSize: Math.max(12, edit.sizePx * sx),
                    lineHeight: 1.2,
                    color: colorToCss(edit.color),
                  }}
                  value={edit.text}
                  onChange={(e) => updateEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      finishEditingText();
                    }
                    e.stopPropagation();
                  }}
                  onBlur={finishEditingText}
                  placeholder="Type here…"
                  spellCheck={false}
                />
              );
            })()}
        </div>
      </div>

      <div className="zoom__controls">
        <button
          type="button"
          className="icon-btn"
          disabled={!canPrev}
          onClick={() => { if (canPrev) { setSelectedIdx(null); onNavigate(thumbs[pos - 1].index); } }}
        >
          <IconPrev />
        </button>
        <div className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
          {pos + 1} / {thumbs.length}
        </div>
        <button
          type="button"
          className="icon-btn"
          disabled={!canNext}
          onClick={() => { if (canNext) { setSelectedIdx(null); onNavigate(thumbs[pos + 1].index); } }}
        >
          <IconNext />
        </button>
      </div>
    </div>
  );
}

function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  title: string;
}): React.ReactElement {
  // Show fractional values with up to 2 decimals, integers as integers.
  const display = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, "");
  return (
    <div className="compact-slider" title={title}>
      <div className="compact-slider__head">
        <span className="compact-slider__label">{label}</span>
        <span className="compact-slider__value">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function cloneEditShallow(e: Edit): Edit {
  if (e.kind === "freehand") {
    return { ...e, points: e.points.map((p) => [p[0], p[1]] as [number, number]) };
  }
  return { ...e };
}

// Handle visuals + hit-test tolerance live in display pixels so the
// grab zone stays usable regardless of how much the source image is
// scaled to fit the viewport.
const HANDLE_DISPLAY_SIZE = 12;

type SelectHandle = "move" | "nw" | "ne" | "sw" | "se" | "p1" | "p2";

function hitHandle(
  e: Edit,
  px: number,
  py: number,
  tol: number,
): SelectHandle | null {
  const pts = handlePoints(e);
  for (const h of pts) {
    if (Math.abs(h.x - px) <= tol && Math.abs(h.y - py) <= tol) {
      return h.id;
    }
  }
  return null;
}

function handlePoints(
  e: Edit,
): Array<{ id: Exclude<SelectHandle, "move">; x: number; y: number }> {
  switch (e.kind) {
    case "rect":
    case "ellipse":
    case "blur":
    case "simplify":
    case "text":
      return [
        { id: "nw", x: e.x, y: e.y },
        { id: "ne", x: e.x + e.w, y: e.y },
        { id: "sw", x: e.x, y: e.y + e.h },
        { id: "se", x: e.x + e.w, y: e.y + e.h },
      ];
    case "arrow":
      return [
        { id: "p1", x: e.x1, y: e.y1 },
        { id: "p2", x: e.x2, y: e.y2 },
      ];
    default:
      return [];
  }
}

function hitTestEdits(
  list: Edit[],
  px: number,
  py: number,
  tol: number,
): number | null {
  // Top-down so the visually-on-top edit wins.
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitEdit(list[i], px, py, tol)) return i;
  }
  return null;
}

function hitEdit(e: Edit, px: number, py: number, tol: number): boolean {
  switch (e.kind) {
    case "rect":
    case "blur":
    case "simplify":
      return (
        px >= e.x - tol &&
        px <= e.x + e.w + tol &&
        py >= e.y - tol &&
        py <= e.y + e.h + tol
      );
    case "ellipse": {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const rx = Math.max(e.w / 2, 1);
      const ry = Math.max(e.h / 2, 1);
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      return nx * nx + ny * ny <= 1.0 + tol / Math.min(rx, ry);
    }
    case "arrow":
      return (
        distToSegment(px, py, e.x1, e.y1, e.x2, e.y2) <=
        Math.max(e.thickness / 2, tol)
      );
    case "freehand": {
      const r = Math.max(e.thickness / 2, tol);
      for (let i = 0; i < e.points.length - 1; i++) {
        const [ax, ay] = e.points[i];
        const [bx, by] = e.points[i + 1];
        if (distToSegment(px, py, ax, ay, bx, by) <= r) return true;
      }
      return false;
    }
    case "text":
      return (
        px >= e.x - tol &&
        px <= e.x + e.w + tol &&
        py >= e.y - tol &&
        py <= e.y + e.h + tol
      );
  }
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 0.0001) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function applySelectOp(
  original: Edit,
  kind: SelectHandle,
  dx: number,
  dy: number,
  cursor: { x: number; y: number },
  shift: boolean,
): Edit {
  if (kind === "move") {
    return translateEdit(original, dx, dy);
  }
  // Resize (bounding-box-shaped edits) or endpoint drag (arrow).
  if (
    original.kind === "rect" ||
    original.kind === "ellipse" ||
    original.kind === "blur" ||
    original.kind === "simplify" ||
    original.kind === "text"
  ) {
    // Pick the corner opposite the dragged handle; that corner stays
    // pinned while the dragged corner tracks the cursor. Dragging past
    // the anchor flips the box naturally via boxFromStart.
    let fx = original.x;
    let fy = original.y;
    switch (kind) {
      case "nw":
        fx = original.x + original.w;
        fy = original.y + original.h;
        break;
      case "ne":
        fx = original.x;
        fy = original.y + original.h;
        break;
      case "sw":
        fx = original.x + original.w;
        fy = original.y;
        break;
      case "se":
        fx = original.x;
        fy = original.y;
        break;
    }
    let edx = cursor.x - fx;
    let edy = cursor.y - fy;
    if (shift) {
      const side = Math.max(Math.abs(edx), Math.abs(edy));
      edx = edx < 0 ? -side : side;
      edy = edy < 0 ? -side : side;
    }
    const newX = Math.min(fx, fx + edx);
    const newY = Math.min(fy, fy + edy);
    const newW = Math.abs(edx);
    const newH = Math.abs(edy);
    return { ...original, x: newX, y: newY, w: newW, h: newH };
  }
  if (original.kind === "arrow") {
    if (kind === "p1") return { ...original, x1: cursor.x, y1: cursor.y };
    if (kind === "p2") return { ...original, x2: cursor.x, y2: cursor.y };
  }
  return original;
}

function translateEdit(e: Edit, dx: number, dy: number): Edit {
  switch (e.kind) {
    case "rect":
    case "ellipse":
    case "blur":
    case "simplify":
      return { ...e, x: e.x + dx, y: e.y + dy };
    case "arrow":
      return {
        ...e,
        x1: e.x1 + dx,
        y1: e.y1 + dy,
        x2: e.x2 + dx,
        y2: e.y2 + dy,
      };
    case "freehand":
      return {
        ...e,
        points: e.points.map((p) => [p[0] + dx, p[1] + dy] as [number, number]),
      };
    case "text":
      return { ...e, x: e.x + dx, y: e.y + dy };
  }
}

function paintSelection(
  ctx: CanvasRenderingContext2D,
  e: Edit,
  scale: number,
) {
  const dash = 6 * scale;
  const gap = 4 * scale;
  const handleSize = HANDLE_DISPLAY_SIZE * scale;
  const lineW = Math.max(1, 1.25 * scale);
  // Bounding-box dashed outline.
  const bbox = editBBox(e);
  ctx.save();
  ctx.setLineDash([dash, gap]);
  ctx.strokeStyle = "rgba(110, 168, 255, 1)";
  ctx.lineWidth = lineW;
  ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.restore();
  // Handles on top, solid.
  const hs = handleSize;
  ctx.save();
  ctx.fillStyle = "white";
  ctx.strokeStyle = "rgba(110, 168, 255, 1)";
  ctx.lineWidth = lineW;
  for (const h of handlePoints(e)) {
    ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
  }
  ctx.restore();
}

function editBBox(e: Edit): { x: number; y: number; w: number; h: number } {
  switch (e.kind) {
    case "rect":
    case "ellipse":
    case "blur":
    case "simplify":
      return { x: e.x, y: e.y, w: e.w, h: e.h };
    case "arrow": {
      const minX = Math.min(e.x1, e.x2);
      const minY = Math.min(e.y1, e.y2);
      return { x: minX, y: minY, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    }
    case "freehand": {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [x, y] of e.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "text":
      return { x: e.x, y: e.y, w: e.w, h: e.h };
  }
}

