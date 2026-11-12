// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { DocumentSession } from "@cwhy/jade-collaboration/session";
import { Room } from "@cwhy/jade-collaboration/room";
import { gapAt } from "@cwhy/jade-core/model";
import { fixture } from "@cwhy/jade-testkit/browser-fixture";
import { WIRE_VERSION } from "@cwhy/jade-protocol";

async function harness(replication) {
  const room = new Room(fixture()),
    trace = [],
    timers = new Map();
  let timerId = 0,
    clock = 0,
    failWrite = false;
  const socket = {
    readyState: 1,
    send: (raw) => trace.push({ kind: "send", message: JSON.parse(raw) }),
    close: () => trace.push({ kind: "socket-close" }),
  };
  const journal = {
    read: async () => ({}),
    write: async (head, events, checkpoint) => {
      if (failWrite) throw Error("Host journal failed");
      trace.push({
        kind: "write",
        head: structuredClone(head),
        events,
        checkpoint,
      });
    },
    close: () => trace.push({ kind: "journal-close" }),
  };
  const session = await DocumentSession.open("mock-document", "A", () => {}, {
    openJournal: async () => journal,
    readCheckpoint: async () =>
      JSON.stringify({
        wire: WIRE_VERSION,
        record: room.snapshot(),
        cursor: 0,
      }),
    connect: () => socket,
    openState: 1,
    createStream: () => "ports",
    now: () => clock,
    schedule: (fn, ms) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    cancel: (id) => timers.delete(id),
    checkpointEvery: 100,
    ...(replication ? {replication} : {}),
  });
  async function drain() {
    for (let n = 0; n < 10; n++) {
      const ready = [...timers].filter(([, t]) => t.ms === 0);
      for (const [id, t] of ready) {
        timers.delete(id);
        t.fn();
      }
      await session.queue;
      if (![...timers.values()].some((t) => t.ms === 0)) return;
    }
    throw Error("Protocol drain did not settle");
  }
  const receive = (message) => {
    socket.onmessage({ data: JSON.stringify(message) });
  };
  socket.onopen();
  receive({ type: "ready", cursor: 0 });
  await drain();
  assert.equal(session.ready, true);
  return {
    session,
    room,
    trace,
    timers,
    receive,
    drain,
    failNextWrite() {
      failWrite = true;
    },
    tick(ms) {
      clock += ms;
    },
  };
}

test("injected session ports preserve journal-before-send, receipt replay and duplicate handling", async () => {
  const h = await harness(),
    s = h.session;
  const op = s.client.prepare({
    kind: "insert",
    at: gapAt(s.client.state, "bp", 2),
    text: "Q",
    marks: [],
  });
  await s.persistAndSend();
  const sent = h.trace.findIndex(
    (x) => x.kind === "send" && x.message.type === "submit",
  );
  assert.ok(sent > 0);
  assert.equal(h.trace[sent - 1].kind, "write");
  assert.deepEqual(h.trace[sent - 1].head.pending, [op]);
  const event = { cursor: 1, op, receipt: h.room.accept(op) };
  h.tick(20);
  h.receive({ type: "events", events: [event] });
  await h.drain();
  assert.equal(s.cursor, 1);
  assert.deepEqual(s.client.pending, []);
  assert.deepEqual(s.client.base, h.room.snapshot());
  assert.equal(s.status(), "Saved to server");
  assert.equal(s.inflight.size, 0);
  h.receive({ type: "events", events: [event] });
  await h.drain();
  assert.equal(s.metrics.events, 1);
  assert.equal(s.metrics.duplicates, 1);
  s.close();
  assert.ok(h.trace.some((x) => x.kind === "socket-close"));
  assert.ok(h.trace.some((x) => x.kind === "journal-close"));
  assert.equal(h.timers.size, 0);
});

test("host journal failure pauses the session without submitting an unpersisted edit", async () => {
  const h = await harness(),
    s = h.session;
  h.failNextWrite();
  s.client.prepare({
    kind: "insert",
    at: gapAt(s.client.state, "bp", 2),
    text: "Q",
    marks: [],
  });
  await s.persistAndSend();
  assert.equal(s.failed, true);
  assert.equal(s.ready, false);
  assert.equal(s.client.pending.length, 1);
  assert.deepEqual(s.errors, ["Host journal failed"]);
  assert.ok(
    !h.trace.some((x) => x.kind === "send" && x.message.type === "submit"),
  );
  assert.match(s.status(), /editing paused/);
  s.close();
});


test("host replication adapter owns replay and duplicate validation without bypassing durability", async()=>{
  const {publicReplication}=await import('@cwhy/jade-collaboration/public-replication');
  let replays=0,duplicates=0;
  const h=await harness({replay(record,event){replays++;return publicReplication.replay(record,event);},verifyDuplicate(record,event){duplicates++;return publicReplication.verifyDuplicate(record,event);}});
  try {
    const paragraph=Object.values(h.session.client.state.nodes).find(n=>n.live&&n.type==='paragraph');
    const op=h.session.client.prepare({kind:'insert',at:gapAt(h.session.client.state,paragraph.id,0),text:'adapter',marks:[]});
    await h.session.persistAndSend();
    const event={cursor:1,op,receipt:h.room.accept(op)};
    h.receive({type:'event',event});await h.drain();
    assert.equal(replays,1);assert.equal(h.session.durableCursor,1);assert.equal(h.session.client.pending.length,0);
    h.receive({type:'event',event});await h.drain();assert.equal(duplicates,1);assert.equal(h.session.failed,undefined);
  } finally {h.session.close();}
});
