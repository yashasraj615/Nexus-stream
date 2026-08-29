type LoadMarkProps = {
  percent?: number | null;
  label?: string;
  size?: "sm" | "md" | "lg";
};

export function LoadMark({ percent, label, size = "md" }: LoadMarkProps) {
  const known = typeof percent === "number" && Number.isFinite(percent);
  const value = known ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const radius = 18;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;

  return (
    <div className={`load-mark load-${size}${known ? "" : " is-busy"}`} role="status" aria-live="polite">
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle className="load-track" cx="24" cy="24" r={radius} />
        <circle
          className="load-fill"
          cx="24"
          cy="24"
          r={radius}
          strokeDasharray={circ}
          strokeDashoffset={known ? offset : circ * 0.72}
        />
      </svg>
      {known ? <strong>{value}</strong> : null}
      {label ? <p>{label}</p> : null}
    </div>
  );
}
