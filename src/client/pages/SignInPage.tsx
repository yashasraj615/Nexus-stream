import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";

export function SignInPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="sign-in">
      <form className="sign-in-card glass-strong" onSubmit={onSubmit}>
        <div className="brand-lockup">
          <div className="brand-mark">
            <img src="/icon-512.png" alt="Nexus Stream" />
          </div>
          <h1>Nexus Stream</h1>
          <p>Sign in to your library</p>
        </div>
        {error ? <p className="error-banner">{error}</p> : null}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
