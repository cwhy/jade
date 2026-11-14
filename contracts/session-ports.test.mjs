// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { DocumentSession } from "@cwhy/jade-collaboration/session";
import { Room } from "@cwhy/jade-collaboration/room";
import { gapAt } from "@cwhy/jade-core/model";
import { fixture } from "@cwhy/jade-testkit/browser-fixture";
import { WIRE_VERSION } from "@cwhy/jade-protocol";

async function harness(replication, saved = {}) {
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
    read: async () => structuredClone(saved),
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
  receive({ type: "ready", cursor: session.cursor });
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


for(const wire of [43,44,45,46,47,48])test(`wire${wire} journal upgrade preserves immutable pending edits and advertises wire49`,async()=>{
 const room=new Room(fixture()),record=structuredClone(room.snapshot());
 record.state.storageCodec=43;
 const op={actor:"A",stream:"legacy",seq:1,id:"A:legacy:1",epoch:record.state.epoch,intent:{kind:"insert",at:gapAt(record.state,"bp",0),text:"offline",marks:[]}};
 const saved={checkpoint:{wire,record,cursor:0},events:[],head:{stream:"legacy",seq:1,pending:[op],cursor:0}};
 const h=await harness(undefined,saved);
 try {
  assert.deepEqual(h.session.client.pending,[op]);
  assert.equal(h.trace.find(x=>x.kind==="send"&&x.message.type==="hello").message.wire,49);
  assert.deepEqual(h.trace.find(x=>x.kind==="send"&&x.message.type==="submit").message.op,op);
  h.receive({type:"events",events:[{cursor:1,op,receipt:h.room.accept(op)}]});await h.drain();
  assert.equal(h.session.client.pending.length,0);assert.equal(h.session.status(),"Saved to server");
 } finally {h.session.close();}
});
test("unsupported journal versions fail without rewriting the journal",async()=>{
 for(const wire of [42,50])await assert.rejects(()=>harness(undefined,{checkpoint:{wire}}),/original journal retained/);
});

test("codec upgrade preserves receipts and identities, rejects unsupported input without mutation", async () => {
 const {upgradeStorage,STORAGE_CODEC}=await import('@cwhy/jade-core/storage');
 const {apply}=await import('@cwhy/jade-core/model');
 const old=fixture();old.storageCodec=43;
 const before=JSON.stringify(old),next=upgradeStorage(old);
 assert.equal(STORAGE_CODEC,44);assert.equal(next.storageCodec,44);
 assert.deepEqual({...next,storageCodec:43},old);assert.equal(JSON.stringify(old),before);
 const op={actor:"A",stream:"migration",seq:1,id:"A:migration:1",epoch:old.epoch,intent:{kind:"insert",at:gapAt(old,"bp",0),text:"saved",marks:[]}};
 assert.throws(()=>apply(old,op),/codec/);
 const room=new Room(old);const receipt=room.accept(op);
 const record=structuredClone(room.snapshot());record.state.storageCodec=43;
 const snapshot=JSON.stringify(record),restored=new Room(null,record);
 assert.deepEqual(restored.accept(op),receipt);assert.equal(JSON.stringify(record),snapshot);
 for(const codec of [42,45]){const bad={...old,storageCodec:codec};assert.throws(()=>upgradeStorage(bad),/source retained/);assert.equal(bad.storageCodec,codec);}
 const malformed=structuredClone(old);delete malformed.textClaims;
 assert.throws(()=>upgradeStorage(malformed));assert.equal(malformed.storageCodec,43);
});

test("live wire fence rejects legacy/future versions before host data delivery", async()=>{
 const {requireWireVersion}=await import('@cwhy/jade-protocol');
 let deliveries=0;const serve=wire=>{requireWireVersion(wire);deliveries++;};
 for(const wire of [43,44,45,46,47,48,50,null,"49"])assert.throws(()=>serve(wire),/reload required/);
 assert.equal(deliveries,0);serve(49);assert.equal(deliveries,1);
});

test("journal upgrade write failure retains original bytes and never connects",async()=>{
 const old=fixture();old.storageCodec=43;
 const saved={checkpoint:{wire:47,record:{state:old,receipts:{},frontiers:{}},cursor:0},events:[],head:{stream:"legacy",seq:0,pending:[],cursor:0}};
 const bytes=JSON.stringify(saved);let connected=0,closed=0;
 await assert.rejects(()=>DocumentSession.open("mock","A",()=>{}, {
  openJournal:async()=>({read:async()=>structuredClone(saved),write:async()=>{throw Error("atomic write failed");},close:()=>closed++}),
  readCheckpoint:async()=>{throw Error("unexpected checkpoint fetch");},connect:()=>{connected++;},createStream:()=>"new",now:()=>0,schedule:()=>0,cancel:()=>{},checkpointEvery:100,openState:1
 }),/atomic write failed/);
 assert.equal(JSON.stringify(saved),bytes);assert.equal(connected,0);assert.equal(closed,1);
});

test("legacy journal replays saved events before atomically upgrading with pending bytes intact",async()=>{
 const old=fixture();old.storageCodec=43;
 const room=new Room(old),record=structuredClone(room.snapshot());record.state.storageCodec=43;
 const first={actor:"A",stream:"legacy",seq:1,id:"A:legacy:1",epoch:old.epoch,intent:{kind:"insert",at:gapAt(old,"bp",0),text:"saved",marks:[]}};
 const event={cursor:1,op:first,receipt:room.accept(first)};
 const pending={actor:"A",stream:"legacy",seq:2,id:"A:legacy:2",epoch:old.epoch,intent:{kind:"insert",at:gapAt(room.record.state,"bp",0),text:"pending",marks:[]}};
 const saved={checkpoint:{wire:47,record,cursor:0},events:[event],head:{stream:"legacy",seq:2,pending:[pending],cursor:1}},bytes=JSON.stringify(saved);
 const h=await harness(undefined,saved);
 try {
  const write=h.trace.find(x=>x.kind==="write"&&x.checkpoint);
  assert.equal(write.checkpoint.wire,49);assert.equal(write.checkpoint.record.state.storageCodec,44);assert.equal(write.checkpoint.cursor,1);
  assert.deepEqual(write.checkpoint.record.receipts[first.id],event.receipt);
  assert.deepEqual(write.head.pending,[pending]);assert.equal(JSON.stringify(saved),bytes);
  assert.ok(h.trace.indexOf(write)<h.trace.findIndex(x=>x.kind==="send"));
 }finally{h.session.close();}
});
