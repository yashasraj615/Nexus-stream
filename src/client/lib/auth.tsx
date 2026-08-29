import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { clearSearchHistory } from "./search-history";
import { supabase } from "./supabase";

export type UserProfile = {
  username: string;
  avatar_url: string | null;
};

type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateUsername: (username: string) => Promise<{ error: string | null }>;
  updatePassword: (
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) => Promise<{ error: string | null }>;
  uploadAvatar: (file: File) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthState | null>(null);

async function readProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("username, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    username: String(data.username ?? ""),
    avatar_url: (data.avatar_url as string | null) ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) {
      setProfile(null);
      return;
    }
    const next = await readProfile(userId);
    setProfile(next);
  }, [session?.user.id]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    clearSearchHistory();
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const updateUsername = useCallback(
    async (username: string) => {
      const user = session?.user;
      if (!user) return { error: "Not signed in" };
      const trimmed = username.trim();
      if (trimmed.length < 1) return { error: "Username is required" };
      const { data: taken } = await supabase
        .from("user_profiles")
        .select("id")
        .ilike("username", trimmed)
        .neq("id", user.id)
        .maybeSingle();
      if (taken) return { error: "That username is already taken" };
      const { error: profileError } = await supabase.from("user_profiles").upsert({
        id: user.id,
        username: trimmed,
        updated_at: new Date().toISOString(),
      });
      if (profileError) return { error: profileError.message };
      const { error } = await supabase.auth.updateUser({ data: { username: trimmed } });
      if (error) return { error: error.message };
      setProfile((current) => ({ username: trimmed, avatar_url: current?.avatar_url ?? null }));
      return { error: null };
    },
    [session?.user],
  );

  const updatePassword = useCallback(
    async (oldPassword: string, newPassword: string, confirmPassword: string) => {
      const email = session?.user.email;
      if (!email) return { error: "Not signed in" };
      if (newPassword.length < 6) return { error: "New password must be at least 6 characters" };
      if (newPassword !== confirmPassword) return { error: "New passwords do not match" };
      const { error: checkError } = await supabase.auth.signInWithPassword({
        email,
        password: oldPassword,
      });
      if (checkError) return { error: "Current password is incorrect" };
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: error?.message ?? null };
    },
    [session?.user.email],
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      const user = session?.user;
      if (!user) return { error: "Not signed in" };
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (uploadError) return { error: uploadError.message };
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const avatar_url = `${data.publicUrl}?t=${Date.now()}`;
      const { error } = await supabase
        .from("user_profiles")
        .update({ avatar_url, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) return { error: error.message };
      setProfile((current) => ({ username: current?.username ?? "", avatar_url }));
      return { error: null };
    },
    [session?.user],
  );

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      profile,
      signIn,
      signOut,
      refreshProfile,
      updateUsername,
      updatePassword,
      uploadAvatar,
    }),
    [profile, ready, refreshProfile, session, signIn, signOut, updatePassword, updateUsername, uploadAvatar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
