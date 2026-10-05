import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAI, getGenerativeModel, GoogleAIBackend } from "firebase/ai";
import {
  getDatabase,
  ref,
  child,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  off,
  get,
  set,
  remove,
  runTransaction,
} from "firebase/database";
import type { FirebaseModularConfig } from "../../src/adapters/index.ts";
import type { GenerativeModelLike } from "../../src/suggestions/index.ts";

export const app = initializeApp({
  projectId: "demo-suggest-pad",
  apiKey: "demo",
});
export const auth = getAuth(app);
export const db = getDatabase(app);

export const model = getGenerativeModel(
  getAI(app, { backend: new GoogleAIBackend() }),
  { model: "gemini-2.5-flash" },
) as unknown as GenerativeModelLike;

/** Gemini speech; audio comes back as 24 kHz 16-bit mono PCM. */
export const ttsModel = getGenerativeModel(
  getAI(app, { backend: new GoogleAIBackend() }),
  { model: "gemini-2.5-flash-preview-tts" },
) as unknown as {
  generateContent(request: Record<string, unknown>): Promise<unknown>;
};

/** Adapter config for one document's collaborative content. */
export const MAIN_TAB = "main";

/** The first tab keeps the original `content` path so earlier documents still open. */
export function contentConfig(
  docId: string,
  tabId: string,
): FirebaseModularConfig {
  const path =
    tabId === MAIN_TAB
      ? `docs/${docId}/content`
      : `docs/${docId}/tabContent/${tabId}`;
  return {
    ref: ref(db, path),
    child,
    onValue,
    onChildAdded,
    onChildChanged,
    onChildRemoved,
    off,
    get,
    set,
    remove,
    runTransaction,
  } as FirebaseModularConfig;
}
