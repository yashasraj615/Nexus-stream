import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EntryCard } from "../components/EntryCard";
import { apiGet, directoryHref, type DirectoryEntry, type ScanState } from "../lib/api";
import { LoadMark } from "../components/LoadMark";
import { decodeSplat } from "../lib/paths";

export function DirectoryPage() {
  const params = useParams();
  const navigate = useNavigate();
  const currentPath = decodeSplat(params["*"]);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = currentPath ? `?path=${encodeURIComponent(currentPath)}` : "";
    void apiGet<{ entries: DirectoryEntry[]; scan: ScanState }>(`/api/directory${query}`)
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setScan(data.scan);
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
  }, [currentPath]);

  useEffect(() => {
    if (scan?.status !== "scanning") return;
    const id = window.setInterval(() => {
      void apiGet<ScanState>("/api/library/status").then(setScan).catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(id);
  }, [scan?.status]);

  const crumbs = useMemo(() => {
    const parts = currentPath ? currentPath.split("/") : [];
    const items = [{ name: "Directory", path: "" }];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      items.push({ name: part, path: acc });
    }
    return items;
  }, [currentPath]);

  return (
    <section className="page">
      <h2>{currentPath ? currentPath.slice(currentPath.lastIndexOf("/") + 1) : "Directory"}</h2>
      <div className="crumb-row">
        {currentPath ? (
          <button className="back-btn" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        ) : null}
        {crumbs.map((crumb, index) => (
          <Link
            key={crumb.path || "root"}
            to={directoryHref(crumb.path)}
            className={`crumb${index === crumbs.length - 1 ? " current" : ""}`}
          >
            {crumb.name}
            {index < crumbs.length - 1 ? " /" : ""}
          </Link>
        ))}
      </div>
      {scan?.status === "scanning" ? (
        <p className="scan-banner glass">Scanning library… {scan.filesSeen} items</p>
      ) : null}
      {scan?.status === "error" ? (
        <p className="error-banner">{scan.error ?? "Scan failed"}</p>
      ) : null}
      {error ? <p className="error-banner">{error}</p> : null}
      {loading ? (
        <div className="page-loading">
          <LoadMark label="Loading folder" />
        </div>
      ) : entries.length === 0 ? (
        <p className="empty-note">This folder is empty.</p>
      ) : (
        <div className="dir-grid">
          {entries.map((entry) => (
            <EntryCard key={entry.path} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
