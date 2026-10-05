import React, { useState } from "react";
import { authMessage, signIn, signInAsGuest, signUp } from "./session.tsx";

export function SignInPage(): React.ReactElement {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() =>
      mode === "in"
        ? signIn(email, password)
        : signUp(name.trim(), email, password),
    );
  };

  return (
    <main className="sg-auth">
      <form className="sg-auth-card" onSubmit={submit}>
        <svg
          className="sg-logo sg-auth-logo"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 2h8l6 6v14H6z" fill="#4285f4" />
          <path d="M14 2l6 6h-6z" fill="#a1c2fa" />
          <path d="M9 13h8v1.5H9zm0 3h8v1.5H9zm0-6h4v1.5H9z" fill="#fff" />
        </svg>
        <h1>{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <p className="sg-auth-sub">to write with Scribe</p>
        {mode === "up" ? (
          <input
            className="sg-field"
            placeholder="Name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : null}
        <input
          className="sg-field"
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="sg-field"
          type="password"
          placeholder="Password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p className="sg-auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="sg-primary" disabled={busy}>
          {mode === "in" ? "Sign in" : "Create account"}
        </button>
        <div className="sg-auth-alt">
          <button
            type="button"
            className="sg-link"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError("");
            }}
          >
            {mode === "in" ? "Create account" : "I have an account"}
          </button>
          <button
            type="button"
            className="sg-link"
            disabled={busy}
            onClick={() => void run(signInAsGuest)}
          >
            Continue as guest
          </button>
        </div>
      </form>
    </main>
  );
}
