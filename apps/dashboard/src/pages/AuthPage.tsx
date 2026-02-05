import React from "react";
import { api } from "../lib/api";
import { setToken } from "../lib/auth";

type Mode = "login" | "signup";

export default function AuthPage({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = React.useState<Mode>("login");
  const [email, setEmail] = React.useState("you@test.com");
  const [password, setPassword] = React.useState("password123");
  const [displayName, setDisplayName] = React.useState("Darryl");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "signup" ? "/auth/signup" : "/auth/login";
      const payload =
        mode === "signup"
          ? { email, password, displayName }
          : { email, password };

      const resp = await api<{ token: string }>(path, "POST", payload);
      setToken(resp.token);
      onAuthed();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">
            {mode === "signup" ? "Create account" : "Sign in"}
          </h1>

          <button
            className="text-sm text-neutral-300 hover:text-white"
            onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            type="button"
          >
            {mode === "signup" ? "Have an account?" : "New here?"}
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="block text-sm mb-1 text-neutral-300">Display name</label>
              <input
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-sm mb-1 text-neutral-300">Email</label>
            <input
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-neutral-300">Password</label>
            <input
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
            <div className="text-xs text-neutral-500 mt-1">Min 8 characters</div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <button
            className="w-full rounded-lg bg-white text-black font-medium py-2 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
