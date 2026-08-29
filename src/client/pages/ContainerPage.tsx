import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EntryCard } from "../components/EntryCard";
import { MoreButton, useMediaMenu } from "../components/MediaMenu";
import {
  apiGet,
  collectionHref,
  seriesHref,
  watchHref,
  type ContainerPayload,
} from "../lib/api";
import { LoadMark } from "../components/LoadMark";
import { displayTitle } from "../lib/media-label";
import { decodeSplat, directoryHref } from "../lib/paths";

export function SeriesPage() {
  return <ContainerPage expected="series" />;
}

export function CollectionPage() {
  return <ContainerPage expected="collection" />;
}

function ContainerPage({ expected }: { expected: "series" | "collection" }) {
  const params = useParams();
  const navigate = useNavigate();
  const currentPath = decodeSplat(params["*"]);
  const [data, setData] = useState<ContainerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiGet<ContainerPayload>(`/api/container?path=${encodeURIComponent(currentPath)}`)
      .then((payload) => {
        if (cancelled) return;
        if (payload.type !== expected) {
          navigate(
            payload.type === "series" ? seriesHref(payload.currentPath) : collectionHref(payload.currentPath),
            { replace: true },
          );
          return;
        }
        setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath, expected, navigate]);

  const nested = data ? data.currentPath !== data.rootPath : false;
  const firstItem = data?.items[0]?.playPath ?? null;
  const folderLabel = expected === "series" ? "Folders" : "Inside this collection";
  const itemLabel = expected === "series" ? "Episodes" : "Movies";
  const { openMedia } = useMediaMenu();

  return (
    <section className="page">
      <div className="crumb-row">
        <button className="back-btn" type="button" onClick={() => navigate(-1)}>
          Back
        </button>
        <Link to={directoryHref("")} className="crumb">
          Directory
        </Link>
        {data?.ancestors.map((crumb, index) => (
          <Link
            key={crumb.path}
            to={expected === "series" ? seriesHref(crumb.path) : collectionHref(crumb.path)}
            className={`crumb${index === (data.ancestors.length ?? 1) - 1 ? " current" : ""}`}
          >
            {crumb.name}
            {index < data.ancestors.length - 1 ? " /" : ""}
          </Link>
        ))}
      </div>

      {error ? <p className="error-banner">{error}</p> : null}
      {loading || !data ? (
        loading ? (
          <div className="page-loading">
            <LoadMark label="Loading" />
          </div>
        ) : (
          <p className="empty-note">Not found.</p>
        )
      ) : (
        <>
          <article className="hero-card glass series-hero">
            <span className="kicker">{expected === "series" ? "Series" : "Collection"}</span>
            <h2>{data.name}</h2>
            {nested ? <p className="hero-meta">{data.currentName}</p> : null}
            <p className="hero-meta">
              {data.stats.videosInTree} videos
              {data.stats.folders ? ` · ${data.stats.folders} folders here` : ""}
              {data.stats.items ? ` · ${data.stats.items} ${itemLabel.toLowerCase()} here` : ""}
            </p>
            {firstItem ? (
              <div>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => navigate(watchHref(firstItem))}
                  style={{ width: "auto", paddingInline: 22 }}
                >
                  Play
                </button>
              </div>
            ) : null}
          </article>

          {data.folders.length > 0 ? (
            <div>
              <div className="row-title">
                <h3>{folderLabel}</h3>
              </div>
              <div className="dir-grid">
                {data.folders.map((entry) => (
                  <EntryCard key={entry.path} entry={entry} within={expected} />
                ))}
              </div>
            </div>
          ) : null}

          {data.items.length > 0 ? (
            <div>
              <div className="row-title">
                <h3>
                  {itemLabel} · {data.items.length}
                </h3>
              </div>
              {expected === "series" ? (
                <div className="episode-list">
                  {data.items.map((entry) => (
                    <div key={entry.path} className="episode-row glass clickable" onContextMenu={(event) => event.preventDefault()}>
                      <button
                        type="button"
                        className="episode-row-hit"
                        onClick={() => {
                          if (entry.playPath) navigate(watchHref(entry.playPath));
                        }}
                      >
                        <strong className="episode-name" title={entry.name}>
                          {displayTitle(entry.name)}
                        </strong>
                        <span className="episode-play">Play</span>
                      </button>
                      <MoreButton onOpen={(x, y) => openMedia(entry, x, y)} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dir-grid">
                  {data.items.map((entry) => (
                    <EntryCard key={entry.path} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {data.folders.length === 0 && data.items.length === 0 ? (
            <p className="empty-note">This folder is empty.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
