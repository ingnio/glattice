interface Props {
  error: string;
  onDismiss: () => void;
}

/** Plain-language versions of common failures; the raw text stays
 *  available as a tooltip for troubleshooting. */
const KNOWN_ERRORS: { test: RegExp; message: string }[] = [
  {
    test: /os error 32|being used by another process/i,
    message: "That file is in use by another app. Close it there and try again.",
  },
  {
    test: /os error 5\b|access is denied|permission denied/i,
    message:
      "Glattice couldn't access that file or folder. Check that you have permission and that it isn't open elsewhere.",
  },
  {
    test: /os error 2\b|no such file|cannot find the (file|path)/i,
    message: "That file couldn't be found. It may have been moved or deleted.",
  },
  {
    test: /os error 112|no space left|not enough space|disk full/i,
    message: "There isn't enough disk space to finish.",
  },
];

export function describeError(raw: string): { message: string; detail?: string } {
  const cleaned = raw.replace(/^(Error:\s*)+/i, "").trim();
  const known = KNOWN_ERRORS.find((k) => k.test.test(cleaned));
  if (known) return { message: known.message, detail: cleaned };
  return { message: cleaned || "Something went wrong." };
}

export default function ErrorBanner({ error, onDismiss }: Props) {
  const { message, detail } = describeError(error);
  return (
    <div className="banner banner--error" role="alert">
      <span className="banner__text" title={detail}>
        {message}
      </span>
      <button
        type="button"
        className="banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        Dismiss
      </button>
    </div>
  );
}
