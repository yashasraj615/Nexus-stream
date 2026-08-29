import { useEffect, useState } from "react";
import { EntryCard } from "../components/EntryCard";
import { LoadMark } from "../components/LoadMark";
import { apiGet, type DirectoryEntry, type SearchPayload } from "../lib/api";
import { clearSearchHistory, readSearchHistory, rememberSearch } from "../lib/search-history";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults(null);
      setError(null);
      setBusy(false);
      return;
    }
    const handle = window.setTimeout(() => {
      setBusy(true);
      void apiGet<SearchPayload>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((data) => {
          setResults(data);
          setError(null);
          setHistory(rememberSearch(q));
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setBusy(false));
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query]);

  const empty =
    results &&
    !results.movies.length &&
    !results.series.length &&
    !results.music.length &&
    !results.guesses.length;
  const showHistory = query.trim().length === 0;

  return (
    <section className="page">
      <h2>Search</h2>
      <p className="empty-note">
        Movies and music play directly. TV series and multi-part movies open as a list.
      </p>
      <label className="field" style={{ marginTop: 20, maxWidth: 560 }}>
        <span>Find titles</span>
        <input
          value={query}
          placeholder="Search movies, series, music"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error ? <p className="error-banner">{error}</p> : null}
      {showHistory ? (
        history.length ? (
          <div className="search-history">
            <div className="row-title">
              <h3>Recent searches</h3>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  clearSearchHistory();
                  setHistory([]);
                }}
              >
                Clear
              </button>
            </div>
            <div className="search-history-list">
              {history.map((item) => (
                <button
                  key={item}
                  className="search-history-chip"
                  type="button"
                  onClick={() => setQuery(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-note">Search something to start a local history. It clears when you sign out.</p>
        )
      ) : null}
      {busy ? (
        <div className="page-loading">
          <LoadMark size="sm" label="Searching" />
        </div>
      ) : null}
      {results && !busy ? (
        empty ? (
          <p className="empty-note">No matches for “{query.trim()}”.</p>
        ) : (
          <>
            <SearchSection title="Movies" entries={results.movies} />
            <SearchSection title="TV series" entries={results.series} />
            <SearchSection title="Music" entries={results.music} />
            <SearchSection
              title="Similar"
              note="Less certain matches — close names or related folders."
              entries={results.guesses}
            />
          </>
        )
      ) : null}
    </section>
  );
}

function SearchSection({
  title,
  note,
  entries,
}: {
  title: string;
  note?: string;
  entries: DirectoryEntry[];
}) {
  if (!entries.length) return null;
  return (
    <div className="search-section">
      <div className="row-title">
        <h3>{title}</h3>
      </div>
      {note ? <p className="empty-note">{note}</p> : null}
      <div className="dir-grid">
        {entries.map((entry) => (
          <EntryCard key={entry.path} entry={entry} />
        ))}
      </div>
    </div>
  );
}
