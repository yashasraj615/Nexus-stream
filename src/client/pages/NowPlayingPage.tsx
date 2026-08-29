import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cover } from "../components/AudioDock";
import { MoreButton, useMediaMenu } from "../components/MediaMenu";
import { Glyph, icons } from "../components/PlayerIcons";
import { SeekBar } from "../components/SeekBar";
import { formatClock } from "../lib/media";
import { usePlayback } from "../lib/playback";

export function NowPlayingPage() {
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
    seekTo,
    next,
    prev,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    queue,
    index,
  } = usePlayback();
  const [skipFlash, setSkipFlash] = useState<{ dir: -1 | 1; key: number } | null>(null);
  const { openMedia } = useMediaMenu();

  if (!track) {
    return (
      <section className="page now-playing-page">
        <p className="empty-note">Nothing is playing. Pick a track from Directory or Search.</p>
      </section>
    );
  }

  const flashSkip = (delta: number) => {
    seekBy(delta);
    setSkipFlash({ dir: delta < 0 ? -1 : 1, key: Date.now() });
  };

  return (
    <section className="now-playing-page">
      <div className="now-playing-stage">
        <div className="now-playing-top">
          <button className="back-btn" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
          <span>Now playing</span>
          <MoreButton onOpen={(x, y) => openMedia(track, x, y)} />
        </div>
        <div className="now-playing-art">
          <Cover src={artwork} name={track.name} large />
          {skipFlash ? (
            <div
              key={skipFlash.key}
              className={`skip-flash audio ${skipFlash.dir < 0 ? "left" : "right"}`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) setSkipFlash(null);
              }}
            >
              <Glyph d={skipFlash.dir < 0 ? icons.back10 : icons.fwd10} size={28} />
              <strong>10</strong>
            </div>
          ) : null}
        </div>
        <div className="audio-full-copy">
          <h2>{track.name}</h2>
          <p>
            {transcoding
              ? preparePercent != null
                ? `${prepareLabel ?? "Preparing a compatible stream"} · ${Math.round(preparePercent)}%`
                : "Preparing a compatible stream…"
              : track.childLabel ?? "Music"}
            {queue.length > 1 ? ` · ${index + 1} of ${queue.length}` : ""}
          </p>
        </div>
        <SeekBar value={currentTime} max={duration} onChange={seekTo} />
        <div className="audio-times">
          <span>{formatClock(currentTime)}</span>
          <span>{formatClock(duration)}</span>
        </div>
        <div className="audio-full-controls">
          <button type="button" className={shuffle ? "on" : ""} onClick={toggleShuffle} aria-label="Shuffle">
            <Glyph d={icons.shuffle} size={20} />
          </button>
          <button type="button" onClick={() => flashSkip(-10)} aria-label="Back 10 seconds">
            <Glyph d={icons.back10} size={22} />
          </button>
          <button type="button" onClick={prev} aria-label="Previous">
            <Glyph d={icons.prev} size={24} />
          </button>
          <button type="button" className="audio-play large" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            <Glyph d={playing ? icons.pause : icons.play} size={26} fill="currentColor" />
          </button>
          <button type="button" onClick={next} aria-label="Next">
            <Glyph d={icons.next} size={24} />
          </button>
          <button type="button" onClick={() => flashSkip(10)} aria-label="Forward 10 seconds">
            <Glyph d={icons.fwd10} size={22} />
          </button>
          <button type="button" className={repeat !== "off" ? "on" : ""} onClick={cycleRepeat} aria-label="Repeat">
            <Glyph d={icons.repeat} size={20} />
            {repeat === "one" ? <i>1</i> : null}
          </button>
        </div>
        <div className="volume-wrap compact">
          <button type="button" onClick={toggleMute} aria-label="Mute">
            <Glyph d={muted || volume === 0 ? icons.mute : icons.volume} size={18} />
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
    </section>
  );
}
