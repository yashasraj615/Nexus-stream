import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayback } from "../lib/playback";
import { Glyph, icons } from "./PlayerIcons";

export function AudioDock() {
  const { track } = usePlayback();
  if (!track) return null;
  return <AudioMini />;
}

function Cover({ src, name, large }: { src: string; name: string; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const letter = name.slice(0, 1).toUpperCase();
  return (
    <div className={`audio-cover${large ? " large" : ""}`}>
      {src && !broken ? (
        <img src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        <span>{letter}</span>
      )}
    </div>
  );
}

function AudioMini() {
  const navigate = useNavigate();
  const {
    track,
    playing,
    shuffle,
    repeat,
    volume,
    muted,
    currentTime,
    duration,
    artwork,
    transcoding,
    preparePercent,
    prepareLabel,
    toggle,
    seekBy,
    next,
    prev,
    close,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
  } = usePlayback();
  if (!track) return null;
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="audio-dock">
      <div className="audio-mini glass-strong">
        <button className="audio-mini-main" type="button" onClick={() => navigate("/now-playing")}>
          <Cover src={artwork} name={track.name} />
          <span className="audio-mini-copy">
            <strong>{track.name}</strong>
            <em>
              {transcoding
                ? preparePercent != null
                  ? `${prepareLabel ?? "Preparing stream"} · ${Math.round(preparePercent)}%`
                  : "Preparing stream…"
                : track.childLabel ?? "Music"}
            </em>
          </span>
        </button>
        <div className="audio-mini-actions">
          <button type="button" className={shuffle ? "on" : ""} onClick={toggleShuffle} aria-label="Shuffle">
            <Glyph d={icons.shuffle} size={16} />
          </button>
          <button type="button" className="desktop-only" onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
            <Glyph d={icons.back10} size={18} />
          </button>
          <button type="button" className="desktop-only" onClick={prev} aria-label="Previous">
            <Glyph d={icons.prev} size={18} />
          </button>
          <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            <Glyph d={playing ? icons.pause : icons.play} size={18} fill="currentColor" />
          </button>
          <button type="button" className="desktop-only" onClick={next} aria-label="Next">
            <Glyph d={icons.next} size={18} />
          </button>
          <button type="button" className="desktop-only" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
            <Glyph d={icons.fwd10} size={18} />
          </button>
          <button type="button" className={repeat !== "off" ? "on" : ""} onClick={cycleRepeat} aria-label="Repeat">
            <Glyph d={icons.repeat} size={16} />
            {repeat === "one" ? <i>1</i> : null}
          </button>
          <div className="volume-wrap mini">
            <button type="button" onClick={toggleMute} aria-label="Mute">
              <Glyph d={muted || volume === 0 ? icons.mute : icons.volume} size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
        </div>
        <button type="button" className="audio-mini-close" onClick={close} aria-label="Close player">
          <Glyph d={icons.close} size={16} />
        </button>
        <div className="audio-mini-progress" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export { Cover };
