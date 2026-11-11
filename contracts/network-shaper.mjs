// SPDX-License-Identifier: MPL-2.0
import { createServer, connect } from "node:net";
import { performance } from "node:perf_hooks";
// Per-client aggregate serialization schedules, independent upload/download.
// Release = reserved serialization finish + one-way propagation. Splitting into
// 16KiB packets prevents a single socket chunk from evading the byte budget.
export function reserve(next, now, bytes, bytesPerMs, latency) {
  const end = Math.max(next, now) + bytes / bytesPerMs;
  return { next: end, release: end + latency };
}
export async function shape({ port, targetPort, mbps, rtt }) {
  const sockets = new Set(),
    timers = new Set(),
    stats = { upBytes: 0, downBytes: 0, connections: 0, maxQueuedBytes: 0 },
    links = {};
  for (const direction of ["up", "down"])
    links[direction] = { next: 0, queued: 0, sources: new Set() };
  function transfer(direction, src, dst, data) {
    const link = links[direction];
    for (let at = 0; at < data.length; at += 16384) {
      const chunk = data.subarray(at, at + 16384),
        slot = reserve(
          link.next,
          performance.now(),
          chunk.length,
          (mbps * 1000) / 8,
          rtt / 2,
        );
      link.next = slot.next;
      link.queued += chunk.length;
      stats.maxQueuedBytes = Math.max(stats.maxQueuedBytes, link.queued);
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          link.queued -= chunk.length;
          if (!dst.destroyed) {
            dst.write(chunk);
            stats[direction + "Bytes"] += chunk.length;
          }
          if (link.queued < 131072)
            for (const s of link.sources) if (!s.destroyed) s.resume();
        },
        Math.max(0, slot.release - performance.now()),
      );
      timers.add(timer);
    }
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
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
