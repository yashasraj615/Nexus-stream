export function decodeSplat(splat: string | undefined) {
  if (!splat) return "";
  return splat
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

export function encodePath(relativePath: string) {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

export function directoryHref(relativePath: string) {
  if (!relativePath) return "/directory";
  return `/directory/${encodePath(relativePath)}`;
}

export function seriesHref(relativePath: string) {
  return `/series/${encodePath(relativePath)}`;
}

export function collectionHref(relativePath: string) {
  return `/collection/${encodePath(relativePath)}`;
}

export function watchHref(playPath: string) {
  return `/watch?path=${encodeURIComponent(playPath)}`;
}
