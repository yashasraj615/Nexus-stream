import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EntryCard } from "../components/EntryCard";
import { InstallApp } from "../components/InstallApp";
import { RailScroll } from "../components/RailScroll";
import { apiGet, apiSend, type DirectoryEntry } from "../lib/api";
import { useAuth } from "../lib/auth";
import { patchSettings, useSettings } from "../lib/settings";

type Favs = {
  folders: DirectoryEntry[];
  videos: DirectoryEntry[];
  music: DirectoryEntry[];
};

type HistoryItem = { entry: DirectoryEntry; openedAt: number };

export function ProfilePage() {
  const { user, profile, admin, signOut, updateUsername, updatePassword, uploadAvatar } = useAuth();
  const settings = useSettings();
  const [username, setUsername] = useState(
    profile?.username || (user?.user_metadata?.username as string | undefined) || user?.email?.split("@")[0] || "",
  );
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [favs, setFavs] = useState<Favs>({ folders: [], videos: [], music: [] });
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (profile?.username) setUsername(profile.username);
  }, [profile?.username]);

  async function reload() {
    const [favoriteData, historyData] = await Promise.all([
      apiGet<Favs>("/api/favorites"),
      apiGet<{ entries: HistoryItem[] }>("/api/history"),
    ]);
    setFavs(favoriteData);
    setHistory(historyData.entries);
  }

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, []);

  const canChangePassword =
    oldPassword.length > 0 && newPassword.length >= 6 && confirmPassword.length >= 6;

  return (
    <section className="page">
      <h2>Profile</h2>
      {admin ? (
        <Link className="ghost-btn" to="/admin" style={{ display: "inline-flex", marginTop: 8 }}>
          Open Admin Panel
        </Link>
      ) : null}
      {error ? <p className="error-banner">{error}</p> : null}
      {message ? <p className="empty-note">{message}</p> : null}
      <article className="section-card glass" style={{ padding: 22, marginTop: 16 }}>
        <div className="profile-avatar-row">
          <span className="avatar large">
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : (username || "U").slice(0, 1).toUpperCase()}
          </span>
          <label className="ghost-btn avatar-upload">
            Change photo
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void uploadAvatar(file).then((result) => {
                  if (result.error) setError(result.error);
                  else {
                    setMessage("Photo updated.");
                    setError(null);
                  }
                });
              }}
            />
          </label>
          <InstallApp compact />
        </div>
        <p className="hero-meta">Email (cannot change here)</p>
        <h3 style={{ margin: "6px 0 18px" }}>{user?.email}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void updateUsername(username).then((result) => {
              if (result.error) setError(result.error);
              else {
                setMessage("Username saved. This does not change your email.");
                setError(null);
              }
            });
          }}
        >
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <button className="primary-btn" type="submit" style={{ width: "auto", paddingInline: 18 }}>
            Save username
          </button>
        </form>
        <form
          style={{ marginTop: 18 }}
          onSubmit={(event) => {
            event.preventDefault();
            void updatePassword(oldPassword, newPassword, confirmPassword).then((result) => {
              if (result.error) setError(result.error);
              else {
                setOldPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setMessage("Password updated.");
                setError(null);
              }
            });
          }}
        >
          <label className="field">
            <span>Current password</span>
            <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
          </label>
          <label className="field">
            <span>New password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <label className="field">
            <span>Retype new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button className="primary-btn" type="submit" style={{ width: "auto", paddingInline: 18 }} disabled={!canChangePassword}>
            Change password
          </button>
        </form>
        <button className="ghost-btn" type="button" onClick={() => void signOut()} style={{ marginTop: 20 }}>
          Sign out
        </button>
      </article>

      <article className="section-card glass" style={{ padding: 22, marginTop: 22 }}>
        <span className="kicker">Settings</span>
        <h3 style={{ margin: "6px 0 8px" }}>Playback &amp; chrome</h3>
        <p className="empty-note" style={{ marginTop: 0 }}>
          These stay on this device. Auto next is on by default.
        </p>
        <div className="settings-row">
          <div>
            <strong>Auto next episodes</strong>
            <p>Play the next episode when one finishes.</p>
          </div>
          <button
            className={`toggle${settings.autoNextEpisodes ? " on" : ""}`}
            type="button"
            role="switch"
            aria-checked={settings.autoNextEpisodes}
            onClick={() => patchSettings({ autoNextEpisodes: !settings.autoNextEpisodes })}
          >
            <i />
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Auto next songs</strong>
            <p>Play the next song when one finishes.</p>
          </div>
          <button
            className={`toggle${settings.autoNextSongs ? " on" : ""}`}
            type="button"
            role="switch"
            aria-checked={settings.autoNextSongs}
            onClick={() => patchSettings({ autoNextSongs: !settings.autoNextSongs })}
          >
            <i />
          </button>
        </div>
        <div className="settings-row settings-slider">
          <div>
            <strong>Nav &amp; mini player glass</strong>
            <p>Lower is more see-through. Higher is more solid.</p>
          </div>
          <label className="chrome-slider">
            <span>{Math.round(settings.chromeOpacity * 100)}%</span>
            <input
              type="range"
              min={32}
              max={92}
              value={Math.round(settings.chromeOpacity * 100)}
              onChange={(event) => patchSettings({ chromeOpacity: Number(event.target.value) / 100 })}
            />
          </label>
        </div>
      </article>

      <FavSection title="Favorite folders" entries={favs.folders} />
      <FavSection title="Favorite videos & episodes" entries={favs.videos} />
      <FavSection title="Favorite music" entries={favs.music} />

      <div className="row-title">
        <h3>History</h3>
        {history.length ? (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              void apiSend("/api/history", "DELETE").then(() => reload());
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {history.length ? (
        <RailScroll>
          {history.map((item) => (
            <div key={item.entry.path} className="playlist-item">
              <EntryCard entry={item.entry} />
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  void apiSend(`/api/history?path=${encodeURIComponent(item.entry.playPath ?? item.entry.path)}`, "DELETE").then(
                    () => reload(),
                  );
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </RailScroll>
      ) : (
        <p className="empty-note">Nothing watched or listened to yet.</p>
      )}
    </section>
  );
}

function FavSection({ title, entries }: { title: string; entries: DirectoryEntry[] }) {
  return (
    <div>
      <div className="row-title">
        <h3>{title}</h3>
      </div>
      {entries.length ? (
        <RailScroll>
          {entries.map((entry) => (
            <EntryCard key={entry.path} entry={entry} />
          ))}
        </RailScroll>
      ) : (
        <p className="empty-note">None yet.</p>
      )}
    </div>
  );
}
