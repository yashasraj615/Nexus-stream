type SeekBarProps = {
  value: number;
  max: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
};

export function SeekBar({ value, max, onChange, ariaLabel = "Seek" }: SeekBarProps) {
  const duration = max > 0 ? max : 0;
  const current = duration ? Math.min(value, duration) : 0;
  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className="seek-bar" style={{ ["--seek-pct" as string]: `${pct}%` }}>
      <div className="seek-track" />
      <div className="seek-fill" />
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={current}
        aria-label={ariaLabel}
        disabled={!duration}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
