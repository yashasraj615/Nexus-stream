type RepeatMode = "off" | "all" | "one";
type FitMode = "contain" | "cover" | "fill";

export function Glyph({
  d,
  size = 22,
  fill = "none",
}: {
  d: string;
  size?: number;
  fill?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke={fill === "none" ? "currentColor" : "none"}
      strokeWidth={fill === "none" ? 1.8 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export const icons = {
  play: "M8 5.5v13l11-6.5z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  prev: "M6 5v14M18 5 10 12l8 7",
  next: "M18 5v14M6 5l8 7-8 7",
  back10: "M8.5 7.5 6 10l2.5 2.5M6 10h7.5a4.5 4.5 0 1 1 0 9H11",
  fwd10: "M15.5 7.5 18 10l-2.5 2.5M18 10h-7.5a4.5 4.5 0 1 0 0 9H13",
  volume: "M4 9.5h3.2L11 6v12L7.2 14.5H4zM15 9a3.2 3.2 0 0 1 0 6M17.5 7a5.5 5.5 0 0 1 0 10",
  mute: "M4 9.5h3.2L11 6v12L7.2 14.5H4zM16 9l5 6M21 9l-5 6",
  expand: "M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4",
  collapse: "M4 8h4V4M20 8h-4V4M4 16h4v4M20 16h-4v4",
  close: "M6 6l12 12M18 6 6 18",
  shuffle: "M4 7h4l3 5M16 7h4M18 5l2 2-2 2M4 17h4l2-3M16 17h4M18 15l2 2-2 2",
  repeat: "M7 7h9a4 4 0 0 1 4 4v1M17 17H8a4 4 0 0 1-4-4v-1M16 4l3 3-3 3M8 20l-3-3 3-3",
  fit: "M4 8h16v8H4z",
  more: "M12 6a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 12 6zm0 7.4A1.4 1.4 0 1 0 12 10a1.4 1.4 0 0 0 0 2.8zm0 7.4A1.4 1.4 0 1 0 12 18a1.4 1.4 0 0 0 0 2.8z",
  settings:
    "M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6zM19.5 13.1l2 .9-.9 2.4-2.2-.2a7 7 0 0 1-1.5.9l-.3 2.2h-2.5l-.3-2.2a7 7 0 0 1-1.5-.9l-2.2.2-.9-2.4 2-.9a7 7 0 0 1 0-1.8l-2-.9.9-2.4 2.2.2a7 7 0 0 1 1.5-.9l.3-2.2h2.5l.3 2.2a7 7 0 0 1 1.5.9l2.2-.2.9 2.4-2 .9a7 7 0 0 1 0 1.8z",
};

export const fitLabel: Record<FitMode, string> = {
  contain: "Fit",
  cover: "Fill",
  fill: "Stretch",
};

export type { RepeatMode, FitMode };
