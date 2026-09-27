import { describe, it, expect } from "bun:test";
import {
  OTClient,
  Synchronized,
  AwaitingConfirm,
  AwaitingWithBuffer,
} from "../../src/adapters/ot-client.ts";
import { TextOperation } from "../../src/core/index.ts";

// Port of test/specs/client.spec.js (lib/client.js) onto the src state machine.
function createHarness(initialDoc) {
  const h = { doc: initialDoc, sent: null, applied: null };
  h.client = new OTClient({
    sendOperation: function (op) {
      h.sent = op;
    },
    applyOperation: function (op) {
      h.doc = op.apply(h.doc);
      h.applied = op;
    },
  });
  h.takeSent = function () {
    const op = h.sent;
    if (!op) throw new Error("sendOperation wasn't called");
    h.sent = null;
    return op;
  };
  h.applyClient = function (op) {
    h.doc = op.apply(h.doc);
    h.client.applyClient(op);
  };
  return h;
}

function op() {
  return new TextOperation();
}

describe("OTClient state machine (C7)", function () {
  it("starts Synchronized and applies server ops directly", function () {
    const h = createHarness("lorem dolor");
    expect(h.client.state instanceof Synchronized).toBe(true);

    h.client.applyServer(op().retain(6).delete(1).insert("D").retain(4));
    expect(h.doc).toBe("lorem Dolor");
    expect(h.client.state instanceof Synchronized).toBe(true);
  });

  it("runs the lib/client.js sequence: confirm, buffer, transform, ack, retry", function () {
    const h = createHarness("lorem Dolor");

    h.applyClient(op().retain(11).insert(" "));
    expect(h.doc).toBe("lorem Dolor ");
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
    expect(h.client.state.outstanding.equals(op().retain(11).insert(" "))).toBe(true);
    expect(h.takeSent().equals(op().retain(11).insert(" "))).toBe(true);

    h.client.applyServer(op().retain(5).insert(" ").retain(6));
    expect(h.doc).toBe("lorem  Dolor ");
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
    expect(h.client.state.outstanding.equals(op().retain(12).insert(" "))).toBe(true);

    h.applyClient(op().retain(13).insert("S"));
    expect(h.client.state instanceof AwaitingWithBuffer).toBe(true);
    h.applyClient(op().retain(14).insert("i"));
    h.applyClient(op().retain(15).insert("t"));
    expect(h.sent).toBe(null);
    expect(h.doc).toBe("lorem  Dolor Sit");
    expect(h.client.state.outstanding.equals(op().retain(12).insert(" "))).toBe(true);
    expect(h.client.state.buffer.equals(op().retain(13).insert("Sit"))).toBe(true);

    h.client.applyServer(op().retain(6).insert("Ipsum").retain(6));
    expect(h.doc).toBe("lorem Ipsum Dolor Sit");
    expect(h.client.state instanceof AwaitingWithBuffer).toBe(true);
    expect(h.client.state.outstanding.equals(op().retain(17).insert(" "))).toBe(true);
    expect(h.client.state.buffer.equals(op().retain(18).insert("Sit"))).toBe(true);

    h.client.serverAck();
    expect(h.takeSent().equals(op().retain(18).insert("Sit"))).toBe(true);
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
    expect(h.client.state.outstanding.equals(op().retain(18).insert("Sit"))).toBe(true);

    h.client.serverAck();
    expect(h.client.state instanceof Synchronized).toBe(true);
    expect(h.doc).toBe("lorem Ipsum Dolor Sit");

    h.applyClient(op().retain(21).insert("a"));
    h.takeSent();
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
    h.client.serverRetry();
    expect(h.takeSent().equals(op().retain(21).insert("a"))).toBe(true);
    h.client.serverAck();
    expect(h.client.state instanceof Synchronized).toBe(true);
    expect(h.doc).toBe("lorem Ipsum Dolor Sita");

    h.applyClient(op().retain(22).insert("m"));
    h.takeSent();
    h.applyClient(op().retain(23).insert("a"));
    expect(h.client.state instanceof AwaitingWithBuffer).toBe(true);
    h.client.serverRetry();
    expect(h.takeSent().equals(op().retain(22).insert("ma"))).toBe(true);
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
  });

  it("re-sends the outstanding op transformed against the remote op that won its revision", function () {
    const h = createHarness("hello world");
    h.applyClient(op().retain(11).insert("!"));
    h.takeSent();

    // A peer's insert at the front claimed the revision first.
    h.client.applyServer(op().insert(">> ").retain(11));
    h.client.serverRetry();

    expect(h.takeSent().equals(op().retain(14).insert("!"))).toBe(true);
    expect(h.doc).toBe(">> hello world!");
  });

  it("drops an outstanding insert that lost its revision: undoes it locally, never re-sends it", function () {
    const h = createHarness("");
    h.applyClient(op().insert("seed"));
    h.takeSent();

    // The peer's identical seed won revision 0.
    h.client.applyServer(op().insert("seed"));
    expect(h.doc).toBe("seedseed");
    h.client.dropOutstanding();

    expect(h.doc).toBe("seed");
    expect(h.sent).toBe(null);
    expect(h.client.state instanceof Synchronized).toBe(true);
  });

  it("drops the outstanding insert and sends the buffer transformed past its removal", function () {
    const h = createHarness("");
    h.applyClient(op().insert("seed"));
    h.takeSent();
    h.applyClient(op().retain(4).insert("!"));

    h.client.applyServer(op().insert("peer"));
    h.client.dropOutstanding();

    expect(h.doc.length).toBe(5);
    expect(h.doc).toContain("peer");
    expect(h.doc).toContain("!");
    // The re-sent buffer is based on the server document ("peer").
    expect(h.takeSent().apply("peer")).toBe(h.doc);
    expect(h.client.state instanceof AwaitingConfirm).toBe(true);
  });

  it("throws on ack or retry while Synchronized", function () {
    const h = createHarness("");
    expect(function () {
      h.client.serverAck();
    }).toThrow(/no pending operation/);
    expect(function () {
      h.client.serverRetry();
    }).toThrow(/no pending operation/);
  });

  it("converges two clients over random concurrent edits with lost revision races", function () {
    // The server accepts an op only if it is based on the latest revision;
    // otherwise the client catches up and retries, like HistoryStreamHandler.
    for (let trial = 0; trial < 30; trial++) {
      const server = { doc: "abc", history: [] };
      const clients = [0, 1].map(function () {
        const c = { doc: "abc", queue: [], received: 0 };
        c.client = new OTClient({
          sendOperation: function (o) {
            c.queue.push({ op: o, baseRev: c.received });
          },
          applyOperation: function (o) {
            c.doc = o.apply(c.doc);
          },
        });
        return c;
      });
      const deliver = function (c, idx) {
        while (c.received < server.history.length) {
          const entry = server.history[c.received++];
          if (entry.from === idx) c.client.serverAck();
          else c.client.applyServer(entry.op);
        }
      };
      const submit = function (c, idx) {
        const sent = c.queue.shift();
        if (sent.baseRev === server.history.length) {
          server.doc = sent.op.apply(server.doc);
          server.history.push({ from: idx, op: sent.op });
        } else {
          deliver(c, idx);
          c.client.serverRetry();
        }
      };
      for (let step = 0; step < 40; step++) {
        const idx = Math.floor(Math.random() * 2);
        const c = clients[idx];
        const roll = Math.random();
        if (roll < 0.5) {
          const pos = Math.floor(Math.random() * (c.doc.length + 1));
          const ch = String.fromCharCode(97 + (step % 26));
          const o = op().retain(pos).insert(ch).retain(c.doc.length - pos);
          c.doc = o.apply(c.doc);
          c.client.applyClient(o);
        } else if (roll < 0.75 && c.queue.length > 0) {
          submit(c, idx);
        } else {
          deliver(c, idx);
        }
      }
      let guard = 0;
      const busy = function (c) {
        return c.queue.length > 0 || !(c.client.state instanceof Synchronized);
      };
      while (clients.some(busy) && guard++ < 100) {
        clients.forEach(function (c, idx) {
          if (c.queue.length > 0) submit(c, idx);
          deliver(c, idx);
        });
      }
      clients.forEach(function (c, idx) {
        deliver(c, idx);
        expect(c.client.state instanceof Synchronized).toBe(true);
        expect(c.doc).toBe(server.doc);
      });
    }
  });
});
