import type { User } from "@supabase/supabase-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { hashToken, touchSession } from "./admin-store.ts";
import { ADMIN_EMAILS, SUPABASE_KEY, SUPABASE_URL } from "./config.ts";

const supabase =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const userCache = new Map<string, { user: User; until: number }>();

export function requestToken(c: Context) {
  const header = c.req.header("Authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  return bearer || c.req.query("access_token") || "";
}

export function userClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userIsAdmin(user: User) {
  const email = user.email?.trim().toLowerCase();
  if (email && ADMIN_EMAILS.includes(email)) return true;
  return (user.app_metadata as { role?: unknown } | undefined)?.role === "admin";
}

export async function requireUser(c: Context) {
  if (!supabase) return null;
  const token = requestToken(c);
  if (!token) return null;
  const cached = userCache.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  userCache.set(token, { user: data.user, until: Date.now() + 10 * 60 * 1000 });
  if (userCache.size > 80) {
    const oldest = userCache.keys().next().value;
    if (oldest) userCache.delete(oldest);
  }
  touchSession({
    tokenHash: hashToken(token),
    userId: data.user.id,
    email: data.user.email ?? "",
    username: (data.user.user_metadata?.username as string | undefined) ?? null,
  });
  return data.user;
}

export async function requireAdmin(c: Context) {
  const user = await requireUser(c);
  if (!user) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (!userIsAdmin(user)) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  return { ok: true as const, user };
}

export async function requireUserState(c: Context) {
  const user = await requireUser(c);
  const token = requestToken(c);
  if (!user || !token) return null;
  return { user, sb: userClient(token) };
}
