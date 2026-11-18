// SPDX-License-Identifier: MPL-2.0
import {upgradeRecord} from "./storage.js";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, Conflict } from "@cwhy/jade-core/admission";
const clone = (x) => structuredClone(x);
const fingerprint = (x) => JSON.stringify(x);
export class Client {
  #history;
  constructor(actor, stream, room, saved, options = {}) {
    this.actor = actor;
    this.stream = stream;
    this.seq = saved?.seq || 0;
    this.inflight = clone(saved?.inflight || null);
    this.base = immutable(upgradeRecord(saved?.base ? clone(saved.base) : room));
    this.pending = clone(saved?.pending || []);
    this.deferred = new Set(saved?.deferred || []);
    if([...this.deferred].some(id=>!this.pending.some(op=>op.id===id)))throw Error("Invalid deferred queue");
    this.deferMutation = options.deferMutation || (()=>false);
    this.undoStack = this.pending.map((x) => ({ ids: [x.id], group: null }));
    this.redoStack = [];
    this.recovery = [];
    this.#history = this.pending.map((x) => ({
      kind: "edit",
      id: x.id,
      group: null,
    }));
    this.rebuild();
  }
  // Ordinary local actions remain O(1) history updates. Only a rejected
  // decision replays this session-local action ledger. It does not restore a
  // document snapshot or revive discarded Redo after a later edit.
  #reconcileHistory() {
    let undo = [],
      redo = [];
    for (const entry of this.#history) {
      if (this.base.receipts[entry.id]?.outcome === "rejected") continue;
      if (entry.kind === "edit") {
        const previous = undo.at(-1);
        if (entry.group && previous?.group === entry.group)
          previous.ids.push(entry.id);
        else undo.push({ ids: [entry.id], group: entry.group });
        redo = [];
      } else if (entry.kind === "undo") {
        const targets = new Set(entry.targets);
        let found = false;
        undo = undo
          .map((g) => ({
            ...g,
            ids: g.ids.filter((id) => {
              if (!targets.has(id)) return true;
              found = true;
              return false;
            }),
          }))
          .filter((g) => g.ids.length);
        if (found) redo.push(entry.id);
      } else if (redo.includes(entry.target)) {
        redo = redo.filter((id) => id !== entry.target);
        undo.push({ ids: [entry.id], group: null });
      }
    }
    this.undoStack = undo;
    this.redoStack = redo;
  }
  rebuild() {
    this.state = this.base.state;
    for (const op of this.pending) {
      if(this.deferred.has(op.id))continue;
      try {
        this.state = immutable(apply(this.state, op));
      } catch (e) {
        if (!(e instanceof Conflict))
          throw e; /* Keep unresolved immutable outbox entry for room decision. */
      }
    }
  }
  get awaitingDecision() { return this.deferred.size>0; }
  prepare(intent, history = true, group = null) {
    if(this.paused)throw new Conflict("Wait for the document restore to finish");
    if(this.awaitingDecision)throw new Conflict("Wait for the pending operation to finish");
    const op = {
      id: `${this.actor}:${this.stream}:${this.seq + 1}`,
      actor: this.actor,
      stream: this.stream,
      seq: this.seq + 1,
      epoch: this.state.epoch,
      modelVersion: 2,
      intent: clone(intent),
    };
    // Check before allocating a sequence; a local validation error creates no hole.
    const defer=!!this.deferMutation(intent,this.state);
    const next = defer?this.state:apply(this.state, op);
    if(defer)this.deferred.add(op.id);
    this.seq++;
    this.pending.push(op);
    this.state = immutable(next);
    if (history) {
      const previous = this.undoStack.at(-1);
      if (group && previous?.group === group) previous.ids.push(op.id);
      else this.undoStack.push({ ids: [op.id], group });
      this.redoStack = [];
      this.#history.push({ kind: "edit", id: op.id, group });
    }
    return op;
  }
  receive(record) {
    if (record.state.revision < this.base.state.revision) return;
    let rejected = false;
    this.base = immutable(record);
    this.pending = this.pending.filter((op) => {
      const receipt = record.receipts[op.id];
      if (!receipt) return true;
      if (receipt.bytes !== fingerprint(op))
        throw new Error("Receipt payload mismatch");
      if (receipt.outcome === "rejected") {
        if (!this.recovery.some((x) => x.id === op.id))
          this.recovery.push({ id: op.id, reason: receipt.reason });
        rejected = true;
      }
      this.deferred.delete(op.id);
      return false;
    });
    this.rebuild();
    if (rejected) this.#reconcileHistory();
  }
  // A reviewed conditional command may fail normally. The host may acknowledge
  // that terminal outcome only with no later allocated edits or unresolved queue;
  // it must never silently release a rejected branch containing dependent work.
  acknowledgeRejection(id) {
    const receipt=this.base.receipts[id];
    if(receipt?.outcome!=='rejected'||!this.recovery.some(r=>r.id===id)||this.pending.length)return false;
    const op=JSON.parse(receipt.bytes);
    if(op.actor!==this.actor||op.stream!==this.stream||op.seq!==this.seq)return false;
    this.recovery=this.recovery.filter(r=>r.id!==id);
    return true;
  }
  undo() {
    const target = this.undoStack.at(-1);
    if (!target) return false;
    const op = this.prepare(
      { kind: "undo", targets: target.ids.toReversed() },
      false,
    );
    this.#history.push({ kind: "undo", id: op.id, targets: [...target.ids] });
    this.undoStack.pop();
    this.redoStack.push(op.id);
    return true;
  }
  redo() {
    const target = this.redoStack.at(-1);
    if (!target) return false;
    const op = this.prepare({ kind: "undo", target }, false);
    this.#history.push({ kind: "redo", id: op.id, target });
    this.redoStack.pop();
    this.undoStack.push({ ids: [op.id], group: null });
    return true;
  }
  save() {
    return clone({
      seq: this.seq,
      base: this.base,
      pending: this.pending,
      inflight: this.inflight,
      ...(this.deferred.size?{deferred:[...this.deferred]}:{}),
    });
  }
}
