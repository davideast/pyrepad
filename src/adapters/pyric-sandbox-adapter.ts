/**
 * Pyric Sandbox collaborative editing adapter implementing SyncSeam.
 */
import { RefLike } from "./types.ts";
import { AbstractSyncAdapter } from "./base-adapter.ts";

export class PyricSandboxAdapter extends AbstractSyncAdapter {
  constructor(ref: RefLike | null, userId?: string, userColor?: string) {
    super();
    this.setupStreams(ref, "sandbox", userColor || "#0000ff", userId);
    this.initializeConnection();
  }
}
