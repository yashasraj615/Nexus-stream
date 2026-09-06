import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  artworkHref,
  collectionHref,
  directoryHref,
  seriesHref,
  watchHref,
  type DirectoryEntry,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePlayback } from "../lib/playback";
import { MoreButton, useMediaMenu } from "./MediaMenu";

function destinationFor(
  entry: DirectoryEntry,
  within?: "series" | "collection" | "directory",
) {
  if (within === "series" && entry.isDirectory) return seriesHref(entry.path);
  if (within === "collection" && entry.isDirectory) return collectionHref(entry.path);
  if (entry.kind === "series") return seriesHref(entry.path);
  if (entry.kind === "collection") return collectionHref(entry.path);
  if (entry.kind === "track" && entry.playPath) return null;
  if (entry.playPath && !entry.isDirectory) return watchHref(entry.playPath);
  if (entry.isDirectory) return directoryHref(entry.path);
  return null;
}

export function posterPathOf(entry: DirectoryEntry) {
  if (entry.kind === "track") return null;
  return entry.artworkPath ?? (entry.kind === "movie" || entry.kind === "episode" ? entry.playPath : null);
}

export function CardPoster({ entry }: { entry: DirectoryEntry }) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const srcPath = posterPathOf(entry);
  const src = srcPath && token ? artworkHref(srcPath, token, entry.artworkVersion) : "";
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img className="card-art" src={src} alt="" onError={() => setBroken(true)} />;
}

export function EntryCard({
  entry,
  within,
}: {
  entry: DirectoryEntry;
  within?: "series" | "collection" | "directory";
}) {
  const navigate = useNavigate();
  const { playTrack } = usePlayback();
  const { openMedia } = useMediaMenu();
  const href = destinationFor(entry, within);
  const hasArt = Boolean(posterPathOf(entry));
  const action =
    entry.kind === "series"
      ? "Open series"
      : entry.kind === "collection"
        ? "Open collection"
        : entry.playPath
          ? "Play"
          : "Open";

  return (
    <article
      className={`media-card glass clickable${hasArt ? " has-art" : ""}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      <CardPoster entry={entry} />
      <MoreButton onOpen={(x, y) => openMedia(entry, x, y)} />
      <button
        type="button"
        className="media-card-hit"
        onClick={() => {
          if (entry.kind === "track" && entry.playPath) {
            void playTrack(entry.playPath);
            return;
          }
          if (href) navigate(href);
        }}
      >
        {entry.childLabel ? <span className="kind">{entry.childLabel}</span> : null}
        <strong>{entry.name}</strong>
        <span>{action}</span>
      </button>
    </article>
  );
}
