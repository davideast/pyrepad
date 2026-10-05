import React, { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { ref, set } from "firebase/database";
import { auth, db } from "./firebase.ts";
import { emailKey } from "./docs.ts";

export interface Person {
  uid: string;
  name: string;
  color: string;
  email?: string;
  anonymous?: boolean;
}

const PALETTE = [
  "#1a73e8",
  "#d93025",
  "#188038",
  "#e37400",
  "#8430ce",
  "#007b83",
];

function colorFor(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export function personOf(user: User): Person {
  const name =
    user.displayName ||
    user.email?.split("@")[0] ||
    (user.isAnonymous ? "Guest" : "Writer");
  return {
    uid: user.uid,
    name,
    color: colorFor(user.uid),
    email: user.email ?? undefined,
    anonymous: user.isAnonymous,
  };
}

/** undefined while Auth initializes, null when signed out. */
export function useAuthUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

let profileWrite: Promise<unknown> = Promise.resolve();

/** Resolves once the latest sign-in's profile and email claim are written. */
export const profileReady = (): Promise<void> =>
  profileWrite.then(
    () => {},
    () => {},
  );

async function saveProfile(user: User): Promise<void> {
  const p = personOf(user);
  // Invites resolve by email: claim it first so rules can trust the binding.
  let key: string | null = null;
  if (user.email) {
    try {
      await set(ref(db, `emails/${emailKey(user.email)}`), user.uid);
      key = emailKey(user.email);
    } catch {
      // someone else holds this address in the database: no invited access
    }
  }
  await set(ref(db, `users/${user.uid}`), {
    name: p.name,
    color: p.color,
    ...(user.email ? { email: user.email } : {}),
    ...(key ? { emailKey: key } : {}),
  });
}

/** Tracks the whole sign-in so readers can wait for the profile write. */
function tracked(run: () => Promise<User>): Promise<void> {
  const done = run().then(saveProfile);
  profileWrite = done;
  return done;
}

export const signUp = (
  name: string,
  email: string,
  password: string,
): Promise<void> =>
  tracked(async () => {
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    await updateProfile(user, { displayName: name });
    return user;
  });

export const signIn = (email: string, password: string): Promise<void> =>
  tracked(
    async () => (await signInWithEmailAndPassword(auth, email, password)).user,
  );

export const signInAsGuest = (): Promise<void> =>
  tracked(async () => (await signInAnonymously(auth)).user);

export const logOut = (): Promise<void> => signOut(auth);

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match.",
  "auth/wrong-password": "That email and password don't match.",
  "auth/user-not-found": "That email and password don't match.",
  "auth/email-already-in-use": "An account with that email already exists.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/invalid-email": "Enter a valid email address.",
};

export function authMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  return MESSAGES[code] ?? "Couldn't sign you in. Try again.";
}

export function Avatar(props: {
  person: Person;
  size?: number;
}): React.ReactElement {
  const size = props.size ?? 32;
  return (
    <span
      className="sg-avatar"
      style={{
        background: props.person.color,
        width: size,
        height: size,
        fontSize: size * 0.45,
      }}
      aria-hidden="true"
    >
      {props.person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
