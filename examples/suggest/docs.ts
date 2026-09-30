import {
  ref,
  get,
  push,
  update,
  onValue,
  remove,
  query,
  orderByChild,
  limitToLast,
  serverTimestamp,
} from "firebase/database";
import { db, MAIN_TAB } from "./firebase.ts";

export interface DocSummary {
  id: string;
  title: string;
  snippet: string;
  updatedAt: number;
}

export interface DocMeta {
  ownerId: string;
  title: string;
  createdAt: number;
  /** Anyone with the link gets this role; absent when access is restricted. */
  link?: Role;
}

export type Role = "viewer" | "commenter" | "editor";
/** What the signed-in person can do with a document. */
export type Access = Role | "owner";

export const DEFAULT_TITLE = "Untitled document";
const GRID_LIMIT = 100;

export async function createDocument(uid: string): Promise<string> {
  const id = push(ref(db, "docs")).key!;
  await update(ref(db), {
    [`docs/${id}/meta`]: {
      ownerId: uid,
      title: DEFAULT_TITLE,
      createdAt: serverTimestamp(),
    },
    [`userDocs/${uid}/${id}`]: {
      title: DEFAULT_TITLE,
      snippet: "",
      updatedAt: serverTimestamp(),
    },
  });
  return id;
}

export async function loadMeta(docId: string): Promise<DocMeta | null> {
  try {
    const snap = await get(ref(db, `docs/${docId}/meta`));
    return snap.exists() ? (snap.val() as DocMeta) : null;
  } catch {
    return null;
  }
}

/** Newest first; the grid reads only these small summaries, never document content. */
export function watchDocuments(
  uid: string,
  onData: (docs: DocSummary[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(
    ref(db, `userDocs/${uid}`),
    orderByChild("updatedAt"),
    limitToLast(GRID_LIMIT),
  );
  return onValue(
    q,
    (snap) => {
      const docs: DocSummary[] = [];
      snap.forEach((c) => {
        docs.push({ id: c.key!, ...(c.val() as Omit<DocSummary, "id">) });
      });
      onData(docs.reverse());
    },
    onError,
  );
}

export function saveSummary(
  uid: string,
  docId: string,
  fields: { title?: string; snippet?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {
    [`userDocs/${uid}/${docId}/updatedAt`]: serverTimestamp(),
  };
  if (fields.snippet !== undefined) {
    patch[`userDocs/${uid}/${docId}/snippet`] = fields.snippet;
  }
  if (fields.title !== undefined) {
    patch[`userDocs/${uid}/${docId}/title`] = fields.title;
    patch[`docs/${docId}/meta/title`] = fields.title;
  }
  return update(ref(db), patch);
}

export async function deleteDocument(
  uid: string,
  docId: string,
): Promise<void> {
  const patch: Record<string, null> = {
    [`docs/${docId}`]: null,
    [`access/${docId}`]: null,
    [`userDocs/${uid}/${docId}`]: null,
  };
  for (const m of await listMembers(docId)) {
    patch[`shared/${emailKey(m.email)}/${docId}`] = null;
  }
  return update(ref(db), patch);
}

/** Emails are stored lowercased with "." as "," (RTDB keys cannot hold dots). */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

const keyEmail = (key: string) => key.replace(/,/g, ".");

export interface Member {
  email: string;
  role: Role;
}

async function listMembers(docId: string): Promise<Member[]> {
  const snap = await get(ref(db, `access/${docId}/members`));
  const out: Member[] = [];
  snap.forEach((c) => {
    out.push({ email: keyEmail(c.key!), role: c.val() as Role });
  });
  return out;
}

/** Owner only. */
export function watchMembers(
  docId: string,
  onData: (members: Member[]) => void,
): () => void {
  return onValue(
    ref(db, `access/${docId}/members`),
    (snap) => {
      const out: Member[] = [];
      snap.forEach((c) => {
        out.push({ email: keyEmail(c.key!), role: c.val() as Role });
      });
      onData(out.sort((a, b) => a.email.localeCompare(b.email)));
    },
    () => onData([]),
  );
}

export function shareWith(
  docId: string,
  email: string,
  role: Role,
): Promise<void> {
  const key = emailKey(email);
  return update(ref(db), {
    [`access/${docId}/members/${key}`]: role,
    [`shared/${key}/${docId}`]: { role, sharedAt: serverTimestamp() },
  });
}

export function unshare(docId: string, email: string): Promise<void> {
  const key = emailKey(email);
  return update(ref(db), {
    [`access/${docId}/members/${key}`]: null,
    [`shared/${key}/${docId}`]: null,
  });
}

export function setLinkAccess(docId: string, role: Role | null): Promise<void> {
  return role
    ? update(ref(db), { [`docs/${docId}/meta/link`]: role })
    : remove(ref(db, `docs/${docId}/meta/link`));
}

/** Live document meta; null when it is missing or the person has no access. */
export function watchMeta(
  docId: string,
  onData: (meta: DocMeta | null) => void,
): () => void {
  return onValue(
    ref(db, `docs/${docId}/meta`),
    (snap) => onData(snap.exists() ? (snap.val() as DocMeta) : null),
    () => onData(null),
  );
}

/** The role granted to this email by an invite, if any. */
export function watchInvite(
  docId: string,
  email: string | undefined,
  onData: (role: Role | null) => void,
): () => void {
  if (!email) {
    onData(null);
    return () => {};
  }
  return onValue(
    ref(db, `access/${docId}/members/${emailKey(email)}`),
    (snap) => onData(snap.exists() ? (snap.val() as Role) : null),
    () => onData(null),
  );
}

export interface SharedDoc {
  id: string;
  title: string;
  role: Role;
  sharedAt: number;
}

/** Documents others invited this email to. Titles come from each doc's meta. */
export function watchShared(
  email: string | undefined,
  onData: (docs: SharedDoc[]) => void,
): () => void {
  if (!email) {
    onData([]);
    return () => {};
  }
  let live = true;
  const stop = onValue(
    ref(db, `shared/${emailKey(email)}`),
    async (snap) => {
      const entries: { id: string; role: Role; sharedAt: number }[] = [];
      snap.forEach((c) => {
        entries.push({
          id: c.key!,
          ...(c.val() as Omit<SharedDoc, "id" | "title">),
        });
      });
      const docs = await Promise.all(
        entries.map(async (e) => {
          const meta = await loadMeta(e.id);
          return meta ? { ...e, title: meta.title } : null;
        }),
      );
      if (live)
        onData(
          docs
            .filter((d): d is SharedDoc => d !== null)
            .sort((a, b) => b.sharedAt - a.sharedAt),
        );
    },
    () => onData([]),
  );
  return () => {
    live = false;
    stop();
  };
}

export interface DocTab {
  id: string;
  title: string;
  snippet: string;
}

/** Tabs in creation order. The first tab always exists, even before it is renamed. */
export function watchTabs(
  docId: string,
  onData: (tabs: DocTab[]) => void,
): () => void {
  return onValue(ref(db, `docs/${docId}/tabs`), (snap) => {
    const found: (DocTab & { createdAt: number })[] = [];
    snap.forEach((c) => {
      const v = c.val() as {
        title?: string;
        snippet?: string;
        createdAt?: number;
      };
      found.push({
        id: c.key!,
        title: v.title ?? "",
        snippet: v.snippet ?? "",
        createdAt: v.createdAt ?? 0,
      });
    });
    found.sort((a, b) => a.createdAt - b.createdAt);
    const main = found.find((t) => t.id === MAIN_TAB);
    const rest = found.filter((t) => t.id !== MAIN_TAB);
    onData([
      {
        id: MAIN_TAB,
        title: main?.title || "Tab 1",
        snippet: main?.snippet ?? "",
      },
      ...rest.map(({ id, title, snippet }) => ({
        id,
        title: title || "Untitled tab",
        snippet,
      })),
    ]);
  });
}

export async function addTab(docId: string, title: string): Promise<string> {
  const id = push(ref(db, `docs/${docId}/tabs`)).key!.replace(/^-/, "t");
  await update(ref(db), {
    [`docs/${docId}/tabs/${id}`]: { title, createdAt: serverTimestamp() },
  });
  return id;
}

export function renameTab(
  docId: string,
  tabId: string,
  title: string,
): Promise<void> {
  return update(ref(db), {
    [`docs/${docId}/tabs/${tabId}/title`]: title,
    ...(tabId === MAIN_TAB
      ? { [`docs/${docId}/tabs/${tabId}/createdAt`]: 0 }
      : {}),
  });
}

export function deleteTab(docId: string, tabId: string): Promise<void> {
  return update(ref(db), {
    [`docs/${docId}/tabs/${tabId}`]: null,
    [`docs/${docId}/tabContent/${tabId}`]: null,
  });
}

export function saveTabSnippet(
  docId: string,
  tabId: string,
  snippet: string,
): Promise<void> {
  return update(ref(db), {
    [`docs/${docId}/tabs/${tabId}/snippet`]: snippet.slice(0, 240),
  });
}

/** True when a tab still carries its automatic name. */
export function isDefaultTabName(tab: DocTab): boolean {
  return /^(Tab \d+|Untitled tab)$/.test(tab.title);
}
