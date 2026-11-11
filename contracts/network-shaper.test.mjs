// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { performance } from "node:perf_hooks";
import { shape, reserve } from "./network-shaper.mjs";
test("aggregate byte reservations serialize all connections and add propagation only once", () => {
  const a = reserve(0, 100, 125000, 1250, 100),
    b = reserve(a.next, 100, 125000, 1250, 100);
  assert.deepEqual(a, { next: 200, release: 300 });
  assert.deepEqual(b, { next: 300, release: 400 });
  assert.deepEqual(reserve(b.next, 600, 1250, 1250, 100), {
    next: 601,
    release: 701,
  });
});
test("loopback shaper preserves bytes and shares downstream bandwidth across connections", async () => {
  const body = Buffer.alloc(250000);
  for (let i = 0; i < body.length; i += 4) body.writeUInt32LE(i, i);
  const server = createServer((s) => s.on("data", () => s.write(body)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const proxy = await shape({
    port: 0,
    targetPort: server.address().port,
    mbps: 10,
    rtt: 100,
  });
  const started = performance.now();
  try {
    const results = await Promise.all(
      [0, 1].map(
        () =>
          new Promise((ok, no) => {
            const s = connect(proxy.port, "127.0.0.1", () => s.write("x")),
              chunks = [];
            let size = 0;
            s.on("error", no);
            s.on("data", (b) => {
              chunks.push(b);
              size += b.length;
              if (size === body.length) {
                s.destroy();
                ok(Buffer.concat(chunks));
              }
            });
          }),
      ),
    );
    for (const b of results) assert.deepEqual(b, body);
    assert.ok(
      performance.now() - started >= 470,
      "500KB shares 10Mbps plus 100ms propagation",
    );
    assert.equal(proxy.stats.downBytes, 500000);
  } finally {
    await proxy.close();
    await new Promise((r) => server.close(r));
  }
});
