import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { usePlayback } from "../lib/playback";
import { useSettings } from "../lib/settings";
import { MediaMenuProvider } from "./MediaMenu";
import { AudioDock } from "./AudioDock";
import { BottomNav, BrandLockup } from "./Navigation";
import { InstallApp } from "./InstallApp";
import { LoadMark } from "./LoadMark";

export function ProtectedLayout() {
  useSettings();
  const { ready, user } = useAuth();
  const location = useLocation();
  const { track } = usePlayback();
  const theater = location.pathname === "/watch";
  const nowPlaying = location.pathname === "/now-playing";
  const showMini = Boolean(track) && !theater && !nowPlaying;
  const showNav = !theater && !nowPlaying;

  if (!ready) {
    return (
      <div className="loading-screen">
        <LoadMark label="Loading Nexus Stream" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <MediaMenuProvider>
      <div className={`shell${theater || nowPlaying ? " theater" : ""}${showMini ? " has-mini" : ""}`}>
        <div className="main">
          <header className={`topbar${nowPlaying ? " hidden-bar" : ""}`}>
            <BrandLockup />
            <ProfileChip />
          </header>
          {showNav ? <InstallApp /> : null}
          <Outlet />
        </div>
        {showMini ? <AudioDock /> : null}
        {showNav ? <BottomNav /> : null}
      </div>
    </MediaMenuProvider>
  );
}

function ProfileChip() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const label =
    profile?.username ||
    (user?.user_metadata?.username as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Profile";
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <button className="profile-chip glass" type="button" onClick={() => navigate("/profile")}>
      <span className="avatar">
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initial}
      </span>
      <em>{label}</em>
    </button>
  );
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <div className="loading-screen">
        <LoadMark label="Loading Nexus Stream" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return children;
}
