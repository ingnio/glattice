import { useLayoutEffect, useRef } from "react";
import { IconX } from "./icons";

// The one place that lists every keyboard shortcut. When a shortcut is
// added or changed in a view's key handler, update it here too.
const GROUPS: { title: string; rows: [keys: string[], what: string][] }[] = [
  {
    title: "Anywhere",
    rows: [
      [["Ctrl", "Shift", "R"], "Start or stop recording"],
      [["?"], "Show this list"],
    ],
  },
  {
    title: "Selecting a region",
    rows: [
      [["Shift"], "Hold while dragging for a square"],
      [["Esc"], "Cancel, or clear the selected region"],
    ],
  },
  {
    title: "Player",
    rows: [
      [["Space"], "Play or pause"],
      [["←"], "Previous frame"],
      [["→"], "Next frame"],
      [["I"], "Start the clip at this frame"],
      [["O"], "End the clip at this frame"],
      [["X"], "Clear the trim"],
    ],
  },
  {
    title: "Frames",
    rows: [
      [["Ctrl", "click"], "Add or remove a frame from the selection"],
      [["Shift", "click"], "Select a run of frames"],
      [["Delete"], "Delete the selected frames"],
      [["Ctrl", "C"], "Copy the selected frame as an image"],
      [["Ctrl", "scroll"], "Make the thumbnails bigger or smaller"],
    ],
  },
  {
    title: "Editor",
    rows: [
      [["V"], "Select and move"],
      [["R"], "Rectangle"],
      [["E"], "Ellipse"],
      [["A"], "Arrow"],
      [["P"], "Freehand pen"],
      [["T"], "Text"],
      [["N"], "Step number"],
      [["B"], "Blur"],
      [["S"], "Simplify"],
      [["Shift"], "Hold while drawing for a square or circle"],
      [["←"], "Previous frame"],
      [["→"], "Next frame"],
      [["Delete"], "Delete the selected edit, or the frame"],
      [["Ctrl", "C"], "Copy the frame as an image"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Y"], "Redo"],
      [["Esc"], "Stop drawing, then deselect, then leave"],
    ],
  },
];

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // A layout effect, subscribed once, so the listener is in place from
  // the moment the list is on screen until it goes away.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the list is up, keys belong to it: nothing reaches the
      // view underneath (Space would play, Delete would delete...).
      e.stopImmediatePropagation();
      if (e.key === "Escape" || e.key === "?") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="frame-props-modal__chrome">
          <span className="frame-props-modal__title">Keyboard shortcuts</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close (Esc)"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="shortcuts-modal__body">
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-modal__group">
              <h3 className="config__group">{group.title}</h3>
              {group.rows.map(([keys, what]) => (
                <div key={what} className="shortcuts-modal__row">
                  <span>{what}</span>
                  <span className="shortcuts-modal__keys">
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="muted"> + </span>}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
