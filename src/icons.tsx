interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const defaults = {
  size: 20,
  strokeWidth: 2,
};

function svg(size: number, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={defaults.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const IconRecord = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </>,
  );

export const IconRegion = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        strokeDasharray="3 3"
      />
    </>,
  );

export const IconConfig = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
  );

export const IconBack = ({ size = defaults.size }: IconProps) =>
  svg(size, <polyline points="15 18 9 12 15 6" />);

export const IconGrid = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>,
  );

export const IconPlay = ({ size = defaults.size }: IconProps) =>
  svg(size, <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />);

export const IconPause = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      <rect
        x="14"
        y="4"
        width="4"
        height="16"
        fill="currentColor"
        stroke="none"
      />
    </>,
  );

export const IconPrev = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
      <line x1="5" y1="19" x2="5" y2="5" />
    </>,
  );

export const IconNext = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </>,
  );

export const IconStop = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor" stroke="none" />,
  );

export const IconTrash = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>,
  );

export const IconRestore = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>,
  );

export const IconSave = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>,
  );

export const IconX = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
  );

export const IconPlus = ({ size = defaults.size }: IconProps) =>
  svg(size, <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>);

export const IconImageAdd = ({ size = defaults.size }: IconProps) =>
  svg(size, <>
    <rect x="3" y="5" width="15" height="13" rx="2" />
    <circle cx="7.5" cy="9.5" r="1.5" />
    <polyline points="18 14 13 9 6 16" />
    <line x1="20" y1="3" x2="20" y2="9" />
    <line x1="17" y1="6" x2="23" y2="6" />
  </>);

export const IconInfo = ({ size = defaults.size }: IconProps) =>
  svg(size, <>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="12" y1="8" x2="12" y2="8.5" strokeWidth={2.5} strokeLinecap="round" />
  </>);

export const IconSpotlight = ({ size = defaults.size, active = false }: IconProps & { active?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" fill={active ? "currentColor" : "none"} />
    <circle cx="12" cy="12" r="8.5" strokeOpacity={active ? 1 : 0.4} />
  </svg>
);

export const IconLogo = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>,
  );

export const IconSun = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="7" y2="7" />
      <line x1="17" y1="17" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="7" y2="17" />
      <line x1="17" y1="7" x2="19.1" y2="4.9" />
    </>,
  );

export const IconMoon = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  );

export const IconUpload = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </>,
  );

export const IconChevron = ({ size = defaults.size }: IconProps) =>
  svg(size, <polyline points="6 9 12 15 18 9" />);

/** Two arrows pointing inward: shrink to the compact layout. */
export const IconCompact = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </>,
  );

/** Two arrows pointing outward: back to the full layout. */
export const IconExpand = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </>,
  );

export const IconMore =({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </>,
  );

export const IconEnvelope = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </>,
  );

export const IconEye = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  );

export const IconFolder = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  );

export const IconLoop = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>,
  );

export const IconCheckAll = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="20 6 9 17 4 12" />
    </>,
  );

export const IconCheckboxChecked = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="8 12 11 15 16 9" />
    </>,
  );

export const IconCheckboxEmpty = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </>,
  );

export const IconExcludeAll = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
  );

export const IconArrow = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="10 5 19 5 19 14" />
    </>,
  );

export const IconRectTool = ({ size = defaults.size }: IconProps) =>
  svg(size, <rect x="4" y="5" width="16" height="14" rx="1" />);

export const IconCircleTool = ({ size = defaults.size }: IconProps) =>
  svg(size, <circle cx="12" cy="12" r="8" />);

export const IconPen = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M3 21l3.5-1 11.1-11.1-2.5-2.5L4 17.5z" />
      <line x1="14" y1="6" x2="18" y2="10" />
    </>,
  );

export const IconCamera = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>,
  );

/** A tall page with a downward arrow: scrolling screenshot. */
export const IconScroll = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2" />
      <line x1="12" y1="7" x2="12" y2="16" />
      <polyline points="8.5 12.5 12 16 15.5 12.5" />
    </>,
  );

/** A numbered list: step-by-step guide. */
export const IconSteps = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <circle cx="4.5" cy="6" r="1.8" />
      <circle cx="4.5" cy="12" r="1.8" />
      <circle cx="4.5" cy="18" r="1.8" />
    </>,
  );

/** A numbered marker: a circle with a 1 in it. */
export const IconStep = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="10.5 9.5 12.5 8 12.5 16" />
    </>,
  );

export const IconText = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="9" y1="20" x2="15" y2="20" />
    </>,
  );

export const IconSimplify = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect
        x="3"
        y="4"
        width="11"
        height="3"
        rx="1.4"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="3"
        y="10"
        width="18"
        height="3"
        rx="1.4"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="3"
        y="16"
        width="8"
        height="3"
        rx="1.4"
        fill="currentColor"
        stroke="none"
      />
    </>,
  );

export const IconBlur = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="2 3" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </>,
  );

export const IconCursor = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <polygon
      points="4 2 4 20 9 15 12 22 15 21 12 14 19 14 4 2"
      fill="currentColor"
      stroke="none"
    />,
  );

export const IconUndo = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="3 7 3 13 9 13" />
      <path d="M3 13a9 9 0 1 0 3-7" />
    </>,
  );

/** A sheet divided into cells: sprite-sheet layout settings. */
export const IconLayout = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
      <line x1="15" y1="9" x2="15" y2="21" />
    </>,
  );

export const IconCopy = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>,
  );

export const IconCopyAll = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <rect x="8" y="8" width="13" height="13" rx="2" />
    </>,
  );

export const IconLoopOnce = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <line x1="6" y1="3" x2="22" y2="21" stroke="currentColor" />
    </>,
  );

/** Boomerang / ping-pong: arrow going right on top, arrow going left
 *  on the bottom — signals that playback bounces back and forth. */
export const IconBoomerang = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <polyline points="4 7 8 4 12 7" />
      <polyline points="12 17 16 20 20 17" />
      <path d="M8 4h10a3 3 0 0 1 3 3v2" />
      <path d="M16 20H6a3 3 0 0 1-3-3v-2" />
    </>,
  );

export const IconHome = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
      <polyline points="9 21 9 12 15 12 15 21" />
    </>,
  );

export const IconImage = ({ size = defaults.size }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>,
  );
