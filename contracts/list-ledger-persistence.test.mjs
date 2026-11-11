// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { Room, Client } from "@cwhy/jade-testkit/peers";
import { probeDelete } from "@cwhy/jade-testkit/list-probe";
import { captureRange } from "@cwhy/jade-core/selection";
import { text, gapAt, validate } from "@cwhy/jade-core/model";
const worker = fileURLToPath(
  new URL("./list-boundary-worker.mjs", import.meta.url),
);
const logical = (s) => {
  const out = [];
  function walk(id) {
    const n = s.nodes[id];
    out.push({
      id,
      type: n.type,
      children: n.children,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const c of n.children || []) walk(c);
  }
  walk(s.root);
  return out;
};
for (const order of [
  [0, 1, 2],
  [2, 1, 0],
])
  for (const undoOrder of [
    [0, 1],
    [1, 0],
  ])
    test(`SQLite joins/restart lost ACK arrival=${order} Undo=${undoOrder}`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), "jade-join-ledger-")),
        db = join(dir, "room.sqlite");
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const call = (input) => {
        const p = spawnSync(process.execPath, [worker, db], {
          input: JSON.stringify(input),
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        });
        if (input.crash) {
          assert.equal(p.signal, "SIGKILL", p.stderr);
          return;
        }
        assert.equal(p.status, 0, p.stderr);
        return JSON.parse(p.stdout);
      };
      const initial = listFixture({ cell: true });
      call({ kind: "seed", state: initial });
      let record = call({ kind: "read" }),
        clients = ["A", "B", "C"].map((a) => new Client(a, "disk", record));
      for (const c of clients.slice(0, 2)) {
        const point = { block: "ap", offset: 4 },
          op = { id: `${c.actor}:disk:1`, actor: c.actor, epoch: 1 };
        c.prepare(
          probeDelete(c.state, captureRange(c.state, point, point), op).intent,
        );
      }
      clients[2].prepare({
        kind: "insert",
        at: gapAt(initial, "bp", 2),
        text: "中",
        marks: ["strong"],
      });
      clients = clients.map(
        (c) =>
          new Client(
            c.actor,
            "disk",
            null,
            JSON.parse(JSON.stringify(c.save())),
          ),
      );
      const accept = (c, crash = false) => {
        const op = structuredClone(c.pending[0]);
        if (crash) call({ kind: "submit", op, crash: true });
        const result = call({ kind: "submit", op });
        assert.equal(result.receipt.outcome, "accepted", result.receipt.reason);
        assert.deepEqual(call({ kind: "submit", op }), result);
        record = call({ kind: "read" });
        assert.deepEqual(record, result.record);
        c.receive(record);
      };
      const settle = () => {
        for (const c of clients) {
          c.receive(record);
          assert.deepEqual(c.recovery, []);
          assert.deepEqual(c.state, record.state);
        }
        validate(record.state);
      };
      for (const [n, i] of order.entries()) accept(clients[i], n === 0);
      settle();
      assert.equal(
        text(record.state, "ap")
          .map((a) => a.char)
          .join(""),
        "aaaabb中bb",
      );
      for (const [n, i] of undoOrder.entries()) {
        clients[i].undo();
        accept(clients[i], n === 0);
        settle();
        if (n === 0) assert.equal(record.state.nodes.b.live, false);
      }
      assert.equal(
        text(record.state, "bp")
          .map((a) => a.char)
          .join(""),
        "bb中bb",
      );
      clients[2].undo();
      accept(clients[2]);
      settle();
      assert.deepEqual(logical(record.state), logical(initial));
    });
