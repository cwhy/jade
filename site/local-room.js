// SPDX-License-Identifier: MPL-2.0
import { Room } from '@cwhy/jade-collaboration/room';
import { Client } from '@cwhy/jade-collaboration/client';

// Demo host only: real clients and authority, in memory, with no network or storage.
// This is not a production transport, persistence layer, or authentication model.
export class LocalRoom {
  constructor(state) { this.room = new Room(state); this.peers = []; this.scheduled = false; this.closed = false; }
  add(actor, changed) {
    const peer = { client: new Client(actor, 'playground', this.room.snapshot()), connected: true, changed };
    this.peers.push(peer); return peer;
  }
  schedule() {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; if (!this.closed) this.flush(); });
  }
  flush() {
    // Catch up before submitting queued edits; accepted decisions then fan out.
    for (const peer of this.peers.filter(p => p.connected)) {
      peer.changed(() => peer.client.receive(this.room.snapshot()));
      for (const operation of [...peer.client.pending]) this.room.accept(operation);
    }
    for (const peer of this.peers.filter(p => p.connected))
      peer.changed(() => peer.client.receive(this.room.snapshot()));
  }
  toggle(peer) { peer.connected = !peer.connected; peer.changed(() => {}); this.schedule(); }
  close() { this.closed = true; this.peers.length = 0; }
}
