// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { OrderedLink, shape } from "./ordered-network-shaper.mjs";
import { createServer, connect } from "node:net";
import { performance } from "node:perf_hooks";
test("early/late timer wakes never release bytes early or reorder them", () => {
  let now = 0;
  const timers = [],
    seen = [];
  const l = new OrderedLink({
    mbps: 50,
    rtt: 100,
    clock: () => now,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    cancel: () => {},
    deliver: (x) => seen.push(x.chunk[0]),
  });
  for (let i = 0; i < 40; i++) l.add(Buffer.from([i]), null);
  assert.equal(timers.length, 1);
  now = 49;
  timers.shift()();
  assert.deepEqual(seen, []);
  assert.equal(timers.length, 1);
  now = 60;
  timers.shift()();
  assert.deepEqual(
    seen,
    Array.from({ length: 40 }, (_, i) => i),
  );
  assert.equal(l.queued, 0);
  l.close();
});
test("burst traffic across sockets preserves position-coded bytes and aggregate rate", async () => {
  const body = Buffer.alloc(250000);
  for (let i = 0; i < body.length; i += 4) body.writeUInt32LE(i, i);
  const server = createServer((s) =>
    s.on("data", () => {
      for (let at = 0; at < body.length; at += 997)
        s.write(body.subarray(at, at + 997));
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const p = await shape({
    port: 0,
    targetPort: server.address().port,
    mbps: 10,
    rtt: 100,
  });
  const start = performance.now();
  try {
    const result = await Promise.all(
      [0, 1].map(
        () =>
          new Promise((resolve, reject) => {
            const s = connect(p.port, "127.0.0.1", () => s.write("x"));
            let size = 0;
            const parts = [];
            s.on("error", reject);
            s.on("data", (b) => {
              size += b.length;
              parts.push(b);
              if (size === body.length) {
                s.destroy();
                resolve(Buffer.concat(parts));
              }
            });
          }),
      ),
    );
    for (const r of result) assert.deepEqual(r, body);
    assert.ok(performance.now() - start >= 470);
    assert.equal(p.stats.downBytes, 500000);
  } finally {
    await p.close();
    await new Promise((r) => server.close(r));
  }
});
