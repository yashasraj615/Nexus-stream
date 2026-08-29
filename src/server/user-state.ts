import type { SupabaseClient } from "@supabase/supabase-js";

type Lumora = SupabaseClient;

export type ProgressRow = {
  user_id: string;
  media_key: string;
  position_s: number;
  duration_s: number;
  updated_at: number;
};

export type PlaylistRow = {
  id: string;
  user_id: string;
  name: string;
  kind: "video" | "audio";
  created_at: number;
};

function epoch(value: string | null | undefined) {
  return value ? new Date(value).getTime() : Date.now();
}

function throwIf(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function playbackIsComplete(position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration < 8) return false;
  return position / duration >= 0.9 || duration - position <= 12;
}

export async function upsertProgress(
  sb: Lumora,
  userId: string,
  mediaKey: string,
  position: number,
  duration: number,
) {
  if (playbackIsComplete(position, duration)) {
    await deleteProgress(sb, userId, mediaKey);
    return { completed: true as const };
  }
  const { error } = await sb.from("playback_progress").upsert({
    user_id: userId,
    media_key: mediaKey,
    position_s: position,
    duration_s: duration,
    updated_at: new Date().toISOString(),
  });
  throwIf(error);
  return { completed: false as const };
}

export async function getProgress(sb: Lumora, userId: string, mediaKey: string) {
  const { data, error } = await sb
    .from("playback_progress")
    .select("user_id, media_key, position_s, duration_s, updated_at")
    .eq("user_id", userId)
    .eq("media_key", mediaKey)
    .maybeSingle();
  throwIf(error);
  if (!data) return undefined;
  return {
    user_id: data.user_id as string,
    media_key: data.media_key as string,
    position_s: Number(data.position_s ?? 0),
    duration_s: Number(data.duration_s ?? 0),
    updated_at: epoch(data.updated_at as string),
  } satisfies ProgressRow;
}

export async function listContinueWatching(sb: Lumora, userId: string, limit = 18) {
  const { data, error } = await sb
    .from("playback_progress")
    .select("user_id, media_key, position_s, duration_s, updated_at")
    .eq("user_id", userId)
    .gt("duration_s", 15)
    .gt("position_s", 5)
    .order("updated_at", { ascending: false })
    .limit(limit * 2);
  throwIf(error);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      user_id: String(row.user_id),
      media_key: String(row.media_key),
      position_s: Number(row.position_s ?? 0),
      duration_s: Number(row.duration_s ?? 0),
      updated_at: epoch(row.updated_at as string),
    }))
    .filter((row) => row.duration_s > 0 && !playbackIsComplete(row.position_s, row.duration_s))
    .slice(0, limit);
}

export async function deleteProgress(sb: Lumora, userId: string, mediaKey: string) {
  const { error } = await sb.from("playback_progress").delete().eq("user_id", userId).eq("media_key", mediaKey);
  throwIf(error);
}

export async function touchHistory(sb: Lumora, userId: string, mediaKey: string) {
  const { error } = await sb.from("watch_history").upsert({
    user_id: userId,
    media_key: mediaKey,
    opened_at: new Date().toISOString(),
  });
  throwIf(error);
}

export async function listHistory(sb: Lumora, userId: string, limit = 40) {
  const { data, error } = await sb
    .from("watch_history")
    .select("media_key, opened_at")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  throwIf(error);
  return ((data ?? []) as Array<{ media_key: string; opened_at: string }>).map((row) => ({
    media_key: row.media_key,
    opened_at: epoch(row.opened_at),
  }));
}

export async function deleteHistoryItem(sb: Lumora, userId: string, mediaKey: string) {
  const history = await sb.from("watch_history").delete().eq("user_id", userId).eq("media_key", mediaKey);
  throwIf(history.error);
  const progress = await sb.from("playback_progress").delete().eq("user_id", userId).eq("media_key", mediaKey);
  throwIf(progress.error);
}

export async function clearHistory(sb: Lumora, userId: string) {
  const history = await sb.from("watch_history").delete().eq("user_id", userId);
  throwIf(history.error);
  const progress = await sb.from("playback_progress").delete().eq("user_id", userId);
  throwIf(progress.error);
}

export async function listFavoriteKeys(sb: Lumora, userId: string) {
  const { data, error } = await sb
    .from("favorites")
    .select("media_key, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIf(error);
  return ((data ?? []) as Array<{ media_key: string; created_at: string }>).map((row) => ({
    media_key: row.media_key,
    created_at: epoch(row.created_at),
  }));
}

export async function isFavorite(sb: Lumora, userId: string, mediaKey: string) {
  const { data, error } = await sb
    .from("favorites")
    .select("media_key")
    .eq("user_id", userId)
    .eq("media_key", mediaKey)
    .maybeSingle();
  throwIf(error);
  return Boolean(data);
}

export async function toggleFavorite(sb: Lumora, userId: string, mediaKey: string) {
  if (await isFavorite(sb, userId, mediaKey)) {
    const { error } = await sb.from("favorites").delete().eq("user_id", userId).eq("media_key", mediaKey);
    throwIf(error);
    return false;
  }
  const { error } = await sb.from("favorites").insert({
    user_id: userId,
    media_key: mediaKey,
    created_at: new Date().toISOString(),
  });
  throwIf(error);
  return true;
}

function asPlaylist(row: Record<string, unknown>): PlaylistRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name),
    kind: row.kind === "audio" ? "audio" : "video",
    created_at: epoch(row.created_at as string),
  };
}

export async function listPlaylists(sb: Lumora, userId: string) {
  const { data, error } = await sb
    .from("playlists")
    .select("id, user_id, name, kind, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIf(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map(asPlaylist);
}

export async function getPlaylist(sb: Lumora, userId: string, id: string) {
  const { data, error } = await sb
    .from("playlists")
    .select("id, user_id, name, kind, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  throwIf(error);
  return data ? asPlaylist(data as Record<string, unknown>) : undefined;
}

export async function createPlaylist(sb: Lumora, userId: string, name: string, kind: "video" | "audio" = "video") {
  const safeKind = kind === "audio" ? "audio" : "video";
  const { data, error } = await sb
    .from("playlists")
    .insert({
      user_id: userId,
      name: name.trim() || "Untitled",
      kind: safeKind,
    })
    .select("id, user_id, name, kind, created_at")
    .single();
  throwIf(error);
  return asPlaylist(data as Record<string, unknown>);
}

export async function renamePlaylist(sb: Lumora, userId: string, id: string, name: string) {
  const { error } = await sb
    .from("playlists")
    .update({ name: name.trim() || "Untitled" })
    .eq("id", id)
    .eq("user_id", userId);
  throwIf(error);
}

export async function deletePlaylist(sb: Lumora, userId: string, id: string) {
  const { error } = await sb.from("playlists").delete().eq("id", id).eq("user_id", userId);
  throwIf(error);
}

export async function listPlaylistItems(sb: Lumora, id: string) {
  const { data, error } = await sb
    .from("playlist_items")
    .select("media_key, position")
    .eq("playlist_id", id)
    .order("position", { ascending: true });
  throwIf(error);
  return ((data ?? []) as Array<{ media_key: string; position: number }>).map((row) => ({
    media_key: row.media_key,
    position: Number(row.position ?? 0),
  }));
}

export async function addPlaylistItem(
  sb: Lumora,
  id: string,
  mediaKey: string,
  expectedKind?: "video" | "audio",
) {
  if (expectedKind) {
    const { data, error } = await sb.from("playlists").select("kind").eq("id", id).maybeSingle();
    throwIf(error);
    if (data && data.kind !== expectedKind) {
      throw new Error(`This playlist only accepts ${data.kind}`);
    }
  }
  const { data: existing, error: listError } = await sb
    .from("playlist_items")
    .select("position")
    .eq("playlist_id", id)
    .order("position", { ascending: false })
    .limit(1);
  throwIf(listError);
  const next = Number(existing?.[0]?.position ?? -1) + 1;
  const { error } = await sb.from("playlist_items").upsert(
    {
      playlist_id: id,
      media_key: mediaKey,
      position: next,
    },
    { onConflict: "playlist_id,media_key", ignoreDuplicates: true },
  );
  throwIf(error);
}

export async function playlistsContaining(sb: Lumora, userId: string, mediaKey: string) {
  const { data: items, error: itemsError } = await sb
    .from("playlist_items")
    .select("playlist_id")
    .eq("media_key", mediaKey);
  throwIf(itemsError);
  const ids = ((items ?? []) as Array<{ playlist_id: string }>).map((item) => item.playlist_id);
  if (!ids.length) return [];
  const { data, error } = await sb
    .from("playlists")
    .select("id, name, kind")
    .eq("user_id", userId)
    .in("id", ids);
  throwIf(error);
  return ((data ?? []) as Array<{ id: string; name: string; kind: string }>).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
  }));
}

export async function removePlaylistItem(sb: Lumora, id: string, mediaKey: string) {
  const { error } = await sb.from("playlist_items").delete().eq("playlist_id", id).eq("media_key", mediaKey);
  throwIf(error);
}
