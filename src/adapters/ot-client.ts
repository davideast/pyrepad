/**
 * OT client state machine, ported from lib/client.js. Pure: no DOM, no timers.
 *
 * At most one local op is in flight (`outstanding`); later local edits are
 * composed into `buffer` until the ack. Remote ops are transformed against both
 * before they reach the host, and a retry re-sends the outstanding op as
 * transformed by the remote op that won its revision.
 */
import { TextOperation } from "../core/index.js";

export interface OTClientHost {
  /** Send `op` to the server at the client's current revision. */
  sendOperation(op: TextOperation): void;
  /** Apply a transformed remote `op` to the local document. */
  applyOperation(op: TextOperation): void;
}

export interface OTClientState {
  applyClient(host: OTClientHost, op: TextOperation): OTClientState;
  applyServer(host: OTClientHost, op: TextOperation): OTClientState;
  serverAck(host: OTClientHost): OTClientState;
  serverRetry(host: OTClientHost): OTClientState;
  dropOutstanding(host: OTClientHost): OTClientState;
}

/** Inverse of an op that only retains and inserts; such an op needs no document text to invert. */
function invertInsertOnly(op: TextOperation): TextOperation {
  if (op.ops.some((part) => part.isDelete())) {
    throw new Error("Only an insert-only operation can be dropped.");
  }
  return op.invert("");
}

/** No local op awaits an ack. */
export class Synchronized implements OTClientState {
  applyClient(host: OTClientHost, op: TextOperation): OTClientState {
    host.sendOperation(op);
    return new AwaitingConfirm(op);
  }

  applyServer(host: OTClientHost, op: TextOperation): OTClientState {
    host.applyOperation(op);
    return this;
  }

  serverAck(): OTClientState {
    throw new Error("There is no pending operation.");
  }

  serverRetry(): OTClientState {
    throw new Error("There is no pending operation.");
  }

  dropOutstanding(): OTClientState {
    throw new Error("There is no pending operation.");
  }
}

const synchronized = new Synchronized();

/** One local op has been sent and awaits its ack. */
export class AwaitingConfirm implements OTClientState {
  constructor(readonly outstanding: TextOperation) {}

  applyClient(_host: OTClientHost, op: TextOperation): OTClientState {
    return new AwaitingWithBuffer(this.outstanding, op);
  }

  applyServer(host: OTClientHost, op: TextOperation): OTClientState {
    const [outstanding, remote] = this.outstanding.transform(op);
    host.applyOperation(remote);
    return new AwaitingConfirm(outstanding);
  }

  serverAck(): OTClientState {
    return synchronized;
  }

  serverRetry(host: OTClientHost): OTClientState {
    host.sendOperation(this.outstanding);
    return this;
  }

  dropOutstanding(host: OTClientHost): OTClientState {
    host.applyOperation(invertInsertOnly(this.outstanding));
    return synchronized;
  }
}

/** One local op awaits its ack; later local edits are held in `buffer`. */
export class AwaitingWithBuffer implements OTClientState {
  constructor(
    readonly outstanding: TextOperation,
    readonly buffer: TextOperation,
  ) {}

  applyClient(_host: OTClientHost, op: TextOperation): OTClientState {
    return new AwaitingWithBuffer(this.outstanding, this.buffer.compose(op));
  }

  applyServer(host: OTClientHost, op: TextOperation): OTClientState {
    const [outstanding, remoteOverOutstanding] = this.outstanding.transform(op);
    const [buffer, remote] = this.buffer.transform(remoteOverOutstanding);
    host.applyOperation(remote);
    return new AwaitingWithBuffer(outstanding, buffer);
  }

  serverAck(host: OTClientHost): OTClientState {
    host.sendOperation(this.buffer);
    return new AwaitingConfirm(this.buffer);
  }

  serverRetry(host: OTClientHost): OTClientState {
    const outstanding = this.outstanding.compose(this.buffer);
    host.sendOperation(outstanding);
    return new AwaitingConfirm(outstanding);
  }

  dropOutstanding(host: OTClientHost): OTClientState {
    // Both the undo and the buffer apply to the document after `outstanding`.
    const [undo, buffer] = invertInsertOnly(this.outstanding).transform(
      this.buffer,
    );
    host.applyOperation(undo);
    host.sendOperation(buffer);
    return new AwaitingConfirm(buffer);
  }
}

export class OTClient {
  state: OTClientState = synchronized;

  constructor(private readonly host: OTClientHost) {}

  /** The user changed the document. */
  applyClient(op: TextOperation): void {
    this.state = this.state.applyClient(this.host, op);
  }

  /** A remote op arrived from the server. */
  applyServer(op: TextOperation): void {
    this.state = this.state.applyServer(this.host, op);
  }

  /** The server accepted the outstanding op. */
  serverAck(): void {
    this.state = this.state.serverAck(this.host);
  }

  /** The outstanding op lost its revision; re-send it (already transformed). */
  serverRetry(): void {
    this.state = this.state.serverRetry(this.host);
  }

  /**
   * The outstanding op lost its revision and must not be re-sent (a seed whose
   * document was seeded by a peer first): undo it locally and send the buffer.
   * The outstanding op must only retain and insert.
   */
  dropOutstanding(): void {
    this.state = this.state.dropOutstanding(this.host);
  }
}
