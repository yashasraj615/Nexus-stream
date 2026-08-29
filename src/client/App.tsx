import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { GuestOnly, ProtectedLayout } from "./components/ProtectedLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { CollectionPage, SeriesPage } from "./pages/ContainerPage";
import { DirectoryPage } from "./pages/DirectoryPage";
import { PlaylistDetailPage, PlaylistsPage } from "./pages/PlaylistsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SearchPage } from "./pages/SearchPage";
import { SignInPage } from "./pages/SignInPage";
import { NowPlayingPage } from "./pages/NowPlayingPage";
import { WatchPage } from "./pages/WatchPage";

export function App() {
  const location = useLocation();

  return (
    <div className="app-root">
      <div className="cosmic-bg" />
      <Routes location={location}>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <SignInPage />
            </GuestOnly>
          }
        />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
          <Route path="/directory" element={<DirectoryPage />} />
          <Route path="/directory/*" element={<DirectoryPage />} />
          <Route path="/series/*" element={<SeriesPage />} />
          <Route path="/collection/*" element={<CollectionPage />} />
          <Route path="/watch" element={<WatchPage />} />
          <Route path="/now-playing" element={<NowPlayingPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
