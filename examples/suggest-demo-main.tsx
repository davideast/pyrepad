/**
 * Suggestion assistant demo. Sign in, keep documents in Realtime Database, and
 * write with "Scribe", an AI assistant that proposes Google Docs-style
 * suggestions. With GEMINI_API_KEY set the model is real Gemini through Pyric's
 * AI Logic passthrough mode; otherwise the sandbox engine answers.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorPage } from "./suggest/editor-page.tsx";
import { GridPage, go } from "./suggest/grid-page.tsx";
import { personOf, signInAsGuest, useAuthUser } from "./suggest/session.tsx";
import { SignInPage } from "./suggest/signin-page.tsx";
import "./suggest-demo.css";

function useRoute(): string {
  const [hash, setHash] = useState(window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function App(): React.ReactElement {
  const user = useAuthUser();
  const route = useRoute();
  const [signingIn, setSigningIn] = useState(false);
  const doc = /^\/d\/([\w-]+)$/.exec(route);
  // A shared link opens for anyone: without an account they join as a guest.
  useEffect(() => {
    if (user === null && doc) void signInAsGuest().catch(() => {});
  }, [user, !!doc]);
  useEffect(() => {
    if (user && !user.isAnonymous) setSigningIn(false);
  }, [user]);
  if (user === undefined || (user === null && doc))
    return <div className="sg-app sg-status">Loading…</div>;
  if (!user || (user.isAnonymous && signingIn)) return <SignInPage />;
  const person = personOf(user);
  if (doc)
    return (
      <EditorPage
        person={person}
        docId={doc[1]!}
        onSignIn={() => setSigningIn(true)}
      />
    );
  if (route !== "/") go("/");
  return <GridPage person={person} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
