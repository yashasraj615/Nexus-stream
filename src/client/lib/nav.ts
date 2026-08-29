export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "home" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/playlists", label: "Playlists", icon: "playlists" },
  { to: "/directory", label: "Directory", icon: "directory" },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"];
