// SPDX-License-Identifier: MPL-2.0
import { createServer, connect } from "node:net";
import { performance } from "node:perf_hooks";
import { reserve } from "./network-shaper.mjs";
// One timer per directional link. Timer rounding/jitter may delay a release,
// but cannot reorder bytes: only the FIFO head is eligible for delivery.
export class OrderedLink {
  constructor({
    mbps,
    rtt,
    clock = () => performance.now(),
    schedule = setTimeout,
    cancel = clearTimeout,
    deliver = () => {},
  }) {
    Object.assign(this, {
      mbps,
      rtt,
      clock,
      schedule,
      cancel,
      deliver,
      next: 0,
      queue: [],
      queued: 0,
      timer: null,
    });
  }
  add(chunk, destination) {
    const slot = reserve(
      this.next,
      this.clock(),
      chunk.length,
      (this.mbps * 1000) / 8,
      this.rtt / 2,
    );
    this.next = slot.next;
    this.queue.push({ chunk, destination, release: slot.release });
    this.queued += chunk.length;
    this.arm();
  }
  arm() {
    if (this.timer !== null || !this.queue.length) return;
    this.timer = this.schedule(
      () => {
        this.timer = null;
        while (this.queue.length && this.queue[0].release <= this.clock()) {
          const item = this.queue.shift();
          this.queued -= item.chunk.length;
          this.deliver(item);
        }
        this.arm();
      },
      Math.max(1, Math.ceil(this.queue[0].release - this.clock())),
    );
  }
  close() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.queue = [];
    this.queued = 0;
  }
}
export async function shape({ port, targetPort, mbps, rtt }) {
  const sockets = new Set(),
    stats = { upBytes: 0, downBytes: 0, connections: 0, maxQueuedBytes: 0 },
    links = {};
  for (const direction of ["up", "down"]) {
    const sources = new Set();
    const link = new OrderedLink({
      mbps,
      rtt,
      deliver: ({ chunk, destination }) => {
        if (!destination.destroyed) {
          destination.write(chunk);
          stats[direction + "Bytes"] += chunk.length;
        }
        if (link.queued < 131072)
          for (const s of sources) if (!s.destroyed) s.resume();
      },
    });
    link.sources = sources;
    links[direction] = link;
  }
  function transfer(direction, src, dst, data) {
    const link = links[direction];
    for (let at = 0; at < data.length; at += 16384)
      link.add(data.subarray(at, at + 16384), dst);
    stats.maxQueuedBytes = Math.max(stats.maxQueuedBytes, link.queued);
    if (link.queued > 524288) for (const s of link.sources) s.pause();
  }
  const server = createServer((down) => {
    const up = connect(targetPort, "127.0.0.1");
    stats.connections++;
    links.up.sources.add(down);
    links.down.sources.add(up);
    for (const s of [down, up]) {
      sockets.add(s);
      s.on("error", () => {
        down.destroy();
        up.destroy();
      });
      s.on("close", () => sockets.delete(s));
    }
    down.on("data", (chunk) => transfer("up", down, up, chunk));
    up.on("data", (chunk) => transfer("down", up, down, chunk));
    down.on("close", () => {
      links.up.sources.delete(down);
      up.destroy();
    });
    up.on("close", () => {
      links.down.sources.delete(up);
      down.destroy();
    });
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", ok);
  });
  return {
    port: server.address().port,
    stats,
    async close() {
      for (const link of Object.values(links)) link.close();
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
