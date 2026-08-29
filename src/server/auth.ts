import type { User } from "@supabase/supabase-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { SUPABASE_KEY, SUPABASE_URL } from "./config.ts";

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
  return data.user;
}

export async function requireUserState(c: Context) {
  const user = await requireUser(c);
  const token = requestToken(c);
  if (!user || !token) return null;
  return { user, sb: userClient(token) };
}
