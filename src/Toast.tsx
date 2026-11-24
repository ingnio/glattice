import { IconX } from "./icons";

interface Props {
  message: string;
  /** "success" confirms something that was done (a save, a discard);
   *  "info" explains why something didn't happen. */
  tone?: "success" | "info";
  /** Optional follow-up, e.g. "Show in folder". */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/** A short message that floats over the top of the window, so finishing
 *  something (a save, a discard), or a control that can't act right now,
 *  never goes unanswered. */
export default function Toast({
  message,
  tone = "success",
  actionLabel,
  onAction,
  onDismiss,
}: Props) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className={`toast__icon toast__icon--${tone}`} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {tone === "success" ? (
            <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
          ) : (
            <>
              <line x1="8" y1="7.5" x2="8" y2="12" />
              <line x1="8" y1="4.2" x2="8" y2="4.3" />
            </>
          )}
        </svg>
      </span>
      <span className="toast__message">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className="toast__dismiss"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <IconX size={12} />
      </button>
    </div>
  );
}
