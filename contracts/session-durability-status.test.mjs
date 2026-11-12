// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { DocumentSession } from "@cwhy/jade-collaboration/session";
import { Room } from "@cwhy/jade-collaboration/room";
import { gapAt } from "@cwhy/jade-core/model";
import { fixture } from "@cwhy/jade-testkit/browser-fixture";
import { WIRE_VERSION } from "@cwhy/jade-protocol";

async function harness({pending = false} = {}) {
  const room = new Room(fixture()),
    timers = new Map(),
    statuses = [], durable = [];
  let timer = 0,
    held = false,
    gate,
    disk,
    session;
  const socket = { readyState: 1, send() {}, close() {} };
  session = await DocumentSession.open(
    "mock-document",
    "A",
    () => statuses.push(session.status()),
    {
      onDurable: value => durable.push({...value, diskCursor: disk.head.cursor}),
      openJournal: async () => ({
        read: async () => ({}),
        close() {},
        async write(head, events, checkpoint) {
          if (held)
            await new Promise(
              (resolve, reject) => (gate = { resolve, reject }),
            );
          disk = structuredClone({ head, events, checkpoint });
        },
      }),
      readCheckpoint: async () =>
        JSON.stringify({
          wire: WIRE_VERSION,
          record: room.snapshot(),
          cursor: 0,
        }),
      connect: () => socket,
      openState: 1,
      createStream: () => "status",
      now: () => 0,
      checkpointEvery: 100,
      schedule(fn, ms) {
        timers.set(++timer, { fn, ms });
        return timer;
      },
      cancel: (id) => timers.delete(id),
    },
  );
  async function deliver(message) {
    socket.onmessage({ data: JSON.stringify(message) });
    for (const [id, t] of [...timers])
      if (t.ms === 0) {
        timers.delete(id);
        t.fn();
      }
    await new Promise((resolve) => setImmediate(resolve));
  }
  socket.onopen();
  await deliver({ type: "ready", cursor: 0 });
  await session.queue;
  const op = session.client.prepare({
    kind: "insert",
    at: gapAt(session.client.state, "bp", 2),
    text: "Q",
    marks: [],
  });
  await session.persistAndSend();
  if (pending) {
    session.client.prepare({kind:"insert",at:gapAt(session.client.state,"bp",3),text:"R",marks:[]});
    await session.persistAndSend();
  }
  held = true;
  await deliver({
    type: "events",
    events: [{ cursor: 1, op, receipt: room.accept(op) }],
  });
  return {
    session,
    statuses,
    durable,
    op,
    disk: () => disk,
    release: () => gate.resolve(),
    reject: () => gate.reject(Error("Journal commit failed")),
  };
}

test("Saved is withheld between acknowledgement application and durable journal completion", async () => {
  const h = await harness(),
    s = h.session;
  try {
    assert.equal(s.client.pending.length, 0);
    assert.equal(s.cursor, 1);
    assert.equal(h.disk().head.cursor, 0);
    assert.equal(s.status(), "Saving");
    assert.equal(h.statuses.at(-1), "Saving");
    h.release();
    await s.queue;
    assert.equal(s.status(), "Saved to server");
    assert.equal(h.disk().head.cursor, 1);
  } finally {
    s.close();
  }
});

test("failed acknowledgement persistence never reports Saved or loses the durable retry payload", async () => {
  const h = await harness(),
    s = h.session;
  try {
    assert.equal(s.status(), "Saving");
    const notifications=h.durable.length;
    h.reject();
    await s.queue;
    assert.equal(h.durable.length,notifications,"failed writes cannot release transport credit");
    assert.equal(s.failed, true);
    assert.match(s.status(), /editing paused/);
    assert.deepEqual(h.disk().head.pending, [h.op]);
    assert.equal(h.disk().head.cursor, 0);
    assert.equal(h.statuses.at(-1), "Local/protocol error — editing paused");
  } finally {
    s.close();
  }
});


test("durable progress notifies transport while later local edits remain pending", async () => {
 const h=await harness({pending:true}),s=h.session;
 try {
  assert.equal(s.client.pending.length,1);
  assert.equal(h.durable.at(-1).cursor,0);
  const renders=h.statuses.length;
  h.release();await s.queue;
  assert.equal(s.client.pending.length,1);
  assert.equal(h.statuses.length,renders,"no extra document render is required");
  assert.deepEqual(h.durable.at(-1),{cursor:1,seq:2,diskCursor:1});
  assert.equal(s.status(),"Saving");
 }finally{s.close();}
});
