// SPDX-License-Identifier: MPL-2.0
// Generic protocol/session orchestration. All platform effects are supplied by the host.
// Ports: openJournal() -> {read, write, close}; readCheckpoint() -> JSON string;
// connect() -> {readyState, send, close, onopen, onmessage, onerror, onclose};
// openState is that connection's open sentinel. schedule/cancel own timers;
// now is monotonic milliseconds. The journal write atomically saves its supplied
// head/events/checkpoint. Optional onDurable({cursor, seq}) runs synchronously
// after journal commit, independently of rendering, for transport flow control.
// Host authentication precedes these capabilities.
import { Client } from "./client.js";
import { WIRE_VERSION } from "@cwhy/jade-protocol";
import { replay } from "./replay.js";
export class DocumentSession {
  static async open(doc, actor, onChange, ports) {
    const session = new DocumentSession(doc, actor, onChange, ports);
    try {
      await session.initialize();
      return session;
    } catch (e) {
      session.close();
      throw e;
    }
  }
  constructor(doc, actor, onChange, ports) {
    if (
      !ports ||
      !Number.isSafeInteger(ports.checkpointEvery) ||
      ports.checkpointEvery < 1
    )
      throw Error("Invalid checkpoint policy");
    for (const key of [
      "openJournal",
      "readCheckpoint",
      "connect",
      "createStream",
      "now",
      "schedule",
      "cancel",
    ])
      if (typeof ports[key] !== "function")
        throw Error("Missing session port: " + key);
    if (ports.replication && (typeof ports.replication.replay !== "function" || typeof ports.replication.verifyDuplicate !== "function"))
      throw Error("Invalid replication adapter");
    this.replication = ports.replication || {
      replay,
      verifyDuplicate(record, event) {
        const existing = record.receipts[event.op.id];
        if (JSON.stringify(existing) !== JSON.stringify(event.receipt) || existing?.bytes !== JSON.stringify(event.op))
          throw Error("Duplicate event changed");
      },
    };
    this.ports = ports;
    Object.assign(this, {
      doc,
      actor,
      onChange,
      cursor: 0,
      durableCursor: 0,
      durableSeq: 0,
      connected: false,
      ready: false,
      manualOffline: false,
      inflight: new Map(),
      inflightBytes: 0,
      inbox: [],
      receiveQueued: false,
      persistQueued: false,
      persistedIds: new Set(),
      queue: Promise.resolve(),
      errors: [],
      metrics: {
        sentBytes: 0,
        receivedBytes: 0,
        checkpointBytes: 0,
        events: 0,
        duplicates: 0,
        reconnects: 0,
        transportErrors: 0,
        journalMs: [],
        ackMs: [],
        commitMs: [],
        rebuildMs: [],
        renderMs: [],
        groups: [],
        maxPending: 0,
        maxInflight: 0,
        maxInflightBytes: 0,
      },
      sentAt: new Map(),
    });
  }
  async initialize() {
    this.journal = await this.ports.openJournal();
    const saved = await this.journal.read();
    let record, stream;
    if (saved.checkpoint) {
      // Wire47 adds image display sizing using optional codec43 node attributes.
      // Prior wire43/44 journals retain their codec43 meaning and immutable
      // operation payloads. This is a one-way reader upgrade.
      if (saved.checkpoint.wire !== WIRE_VERSION && !(WIRE_VERSION === 47 && [43,44,45,46].includes(saved.checkpoint.wire)))
        throw Error(
          "Incompatible lab journal version; original journal retained",
        );
      record = saved.checkpoint.record;
      this.cursor = saved.checkpoint.cursor;
      for (const event of saved.events) {
        if (event.cursor !== this.cursor + 1)
          throw Error("Local journal cursor gap");
        record = this.replication.replay(record, event);
        this.cursor = event.cursor;
      }
      if (this.cursor !== saved.head.cursor)
        throw Error("Local journal head mismatch");
      stream = saved.head.stream;
      this.client = new Client(this.actor, stream, record, {
        seq: saved.head.seq,
        pending: saved.head.pending,
        base: record,
      });
      this.persistedIds = new Set(saved.head.pending.map((op) => op.id));
    } else {
      const raw = await this.ports.readCheckpoint(),
        checkpoint = JSON.parse(raw);
      if (checkpoint.wire !== WIRE_VERSION)
        throw Error("Wire version mismatch");
      this.metrics.checkpointBytes = new TextEncoder().encode(raw).length;
      record = checkpoint.record;
      this.cursor = checkpoint.cursor;
      stream = this.ports.createStream();
      this.client = new Client(this.actor, stream, record);
      await this.journal.write(this.head(), null, {
        wire: WIRE_VERSION,
        record,
        cursor: this.cursor,
      });
    }
    this.durableCursor = this.cursor;
    this.durableSeq = this.client.seq;
    this.connect();
    return this;
  }
  head() {
    return {
      stream: this.client.stream,
      seq: this.client.seq,
      pending: structuredClone(this.client.pending),
      cursor: this.cursor,
    };
  }
  enqueue(fn) {
    this.queue = this.queue
      .then(() => {
        if (!this.failed && !this.closed) return fn();
      })
      .catch((e) => {
        this.errors.push(e.message);
        this.failed = true;
        this.ready = false;
        this.socket?.close();
        this.onChange?.();
      });
    return this.queue;
  }
  async save(head = this.head(), events = []) {
    const start = this.ports.now(),
      previous = events.length ? events[0].cursor - 1 : this.cursor;
    const checkpoint =
      events.length &&
      Math.floor(previous / this.ports.checkpointEvery) !==
        Math.floor(head.cursor / this.ports.checkpointEvery)
        ? { wire: WIRE_VERSION, record: this.client.base, cursor: head.cursor }
        : null;
    await this.journal.write(head, events, checkpoint);
    this.metrics.journalMs.push(this.ports.now() - start);
    this.persistedIds = new Set(head.pending.map((op) => op.id));
    this.durableCursor = head.cursor;
    this.durableSeq = head.seq;
    this.ports.onDurable?.({ cursor: this.durableCursor, seq: this.durableSeq });
  }
  persistAndSend() {
    this.metrics.maxPending = Math.max(
      this.metrics.maxPending,
      this.client.pending.length,
    );
    if (!this.persistQueued) {
      this.persistQueued = true;
      this.enqueue(async () => {
        this.persistQueued = false;
        await this.save(this.head());
        this.pump();
      });
    }
    return this.queue;
  }
  // A single queued drain captures all entries currently available, without
  // allowing a later ready/control message to overtake earlier events.
  receive(m) {
    if (m.type === "events")
      for (const event of m.events)
        this.inbox.push({ type: "event", event, commitMs: m.commitMs });
    else this.inbox.push(m);
    this.scheduleReceive();
  }
  scheduleReceive() {
    if (this.receiveQueued || !this.inbox.length || this.failed || this.closed)
      return;
    this.receiveQueued = true;
    this.receiveTimer = this.ports.schedule(
      () =>
        this.enqueue(async () => {
          this.receiveQueued = false;
          const batch = this.inbox.splice(0, 64);
          await this.messageBatch(batch);
          this.scheduleReceive();
        }),
      0,
    );
  }
  clearFlight() {
    this.inflight.clear();
    this.inflightBytes = 0;
    this.ports.cancel(this.watchdog);
  }
  armWatchdog() {
    this.ports.cancel(this.watchdog);
    if (!this.inflight.size) return;
    const oldest = Math.min(...[...this.inflight.values()].map((x) => x.at));
    this.watchdog = this.ports.schedule(
      () => this.socket?.close(),
      Math.max(1, 10000 - (this.ports.now() - oldest)),
    );
  }
  send(message) {
    const raw = JSON.stringify(message);
    this.metrics.sentBytes += new TextEncoder().encode(raw).length;
    this.socket.send(raw);
  }
  connect() {
    if (this.manualOffline || this.failed || this.closed) return;
    const ws = this.ports.connect();
    this.socket = ws;
    ws.onopen = () => {
      if (ws !== this.socket || this.manualOffline || this.closed) return;
      this.connected = true;
      this.send({
        type: "hello",
        wire: WIRE_VERSION,
        doc: this.doc,
        cursor: this.cursor,
      });
      this.onChange?.();
    };
    ws.onmessage = (e) => {
      if (ws !== this.socket || this.manualOffline || this.closed) return;
      this.metrics.receivedBytes += new TextEncoder().encode(e.data).length;
      try {
        this.receive({ ...JSON.parse(e.data), socket: ws });
      } catch (error) {
        this.enqueue(() => {
          throw error;
        });
      }
    };
    ws.onerror = () => {
      this.metrics.transportErrors++;
    };
    ws.onclose = () => {
      if (ws !== this.socket) return;
      this.connected = false;
      this.ready = false;
      this.clearFlight();
      this.onChange?.();
      if (!this.manualOffline && !this.failed && !this.closed) {
        this.metrics.reconnects++;
        this.retry = this.ports.schedule(() => this.connect(), 200);
      }
    };
  }
  async messageBatch(batch) {
    let record = this.client.base,
      cursor = this.cursor;
    const events = [],
      acknowledged = [];
    let readySocket = null;
    const caret = this.onBeforeChange?.();
    for (const m of batch) {
      if (m.type === "fault-armed") {
        this.faultResolve?.();
        this.faultResolve = null;
        continue;
      }
      if (m.type === "error") throw Error(m.message);
      if (m.type === "ready") {
        // Decisions from the previous socket remain valid; its ready marker does not.
        if (m.socket !== this.socket) continue;
        if (m.cursor !== cursor) throw Error("Authority ready before catchup");
        readySocket = m.socket;
        continue;
      }
      if (m.type !== "event") throw Error("Unknown server message");
      const event = m.event;
      if (event.cursor <= cursor) {
        this.replication.verifyDuplicate(record, event);
        this.metrics.duplicates++;
        continue;
      }
      if (event.cursor !== cursor + 1) throw Error("Wire event cursor gap");
      record = this.replication.replay(record, event);
      cursor = event.cursor;
      events.push(event);
      acknowledged.push(event.op.id);
      if (m.commitMs !== undefined) this.metrics.commitMs.push(m.commitMs);
    }
    if (events.length) {
      let start = this.ports.now();
      this.client.receive(record);
      this.cursor = cursor;
      this.metrics.rebuildMs.push(this.ports.now() - start);
      this.metrics.events += events.length;
      this.metrics.groups.push(events.length);
      start = this.ports.now();
      this.onChange?.(caret);
      this.metrics.renderMs.push(this.ports.now() - start);
      await this.save(this.head(), events);
      for (const id of acknowledged) {
        const flight = this.inflight.get(id);
        if (flight) {
          this.inflightBytes -= flight.bytes;
          this.inflight.delete(id);
        }
        if (this.sentAt.has(id)) {
          this.metrics.ackMs.push(this.ports.now() - this.sentAt.get(id));
          this.sentAt.delete(id);
        }
      }
    }
    if (
      readySocket &&
      readySocket === this.socket &&
      this.connected &&
      !this.manualOffline
    )
      this.ready = true;
    this.armWatchdog();
    this.pump();
    // Render Saved only after the journal commits. Pending event groups already
    // rendered their Saving state before the asynchronous write.
    if (!events.length || !this.client.pending.length) this.onChange?.();
  }
  pump() {
    if (
      !this.ready ||
      this.manualOffline ||
      this.failed ||
      this.closed ||
      this.socket?.readyState !== this.ports.openState
    )
      return;
    for (const op of this.client.pending) {
      if (this.inflight.has(op.id)) continue;
      if (!this.persistedIds.has(op.id) || this.inflight.size >= 16) break;
      const bytes = new TextEncoder().encode(
        JSON.stringify({ type: "submit", op }),
      ).length;
      if (this.inflight.size && this.inflightBytes + bytes > 256 * 1024) break;
      this.inflight.set(op.id, { bytes, at: this.ports.now() });
      this.inflightBytes += bytes;
      this.lastOp = structuredClone(op);
      this.sentAt.set(op.id, this.ports.now());
      this.send({ type: "submit", op });
      this.metrics.maxInflight = Math.max(
        this.metrics.maxInflight,
        this.inflight.size,
      );
      this.metrics.maxInflightBytes = Math.max(
        this.metrics.maxInflightBytes,
        this.inflightBytes,
      );
    }
    this.armWatchdog();
  }
  offline(value) {
    this.manualOffline = value;
    this.ports.cancel(this.retry);
    if (value) {
      this.ready = false;
      this.connected = false;
      this.clearFlight();
      this.socket?.close();
    } else this.connect();
    this.onChange?.();
  }
  async fault(mode) {
    if (!this.ready) throw Error("Connect before arming fault");
    await new Promise((resolve, reject) => {
      const timer = this.ports.schedule(
        () => reject(Error("Fault arm timed out")),
        3000,
      );
      this.faultResolve = () => {
        this.ports.cancel(timer);
        resolve();
      };
      this.send({ type: "fault", mode });
    });
  }
  retryLast() {
    if (!this.lastOp) throw Error("No prior submission");
    this.send({ type: "submit", op: this.lastOp });
  }
  status() {
    if (this.failed) return "Local/protocol error — editing paused";
    if (!this.connected)
      return this.client.pending.length
        ? "Offline — local draft"
        : "Reconnecting";
    if (!this.ready) return "Catching up";
    if (
      this.client.pending.length ||
      this.cursor !== this.durableCursor ||
      this.client.seq !== this.durableSeq
    )
      return "Saving";
    return "Saved to server";
  }
  close() {
    this.closed = true;
    this.ports.cancel(this.retry);
    this.ports.cancel(this.watchdog);
    this.ports.cancel(this.receiveTimer);
    this.socket?.close();
    this.journal?.close();
  }
}
