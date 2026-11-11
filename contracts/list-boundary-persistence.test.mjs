// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { Room, Client } from "@cwhy/jade-testkit/peers";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { text, gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
const worker = fileURLToPath(
  new URL("./list-boundary-worker.mjs", import.meta.url),
);
for (const parent of [false, true])
  for (const order of [
    [0, 1, 2],
    [2, 1, 0],
  ])
    test(`SQLite process death, lost ack and pending-client reload parent=${parent} order=${order}`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), "jade-list-cut-")),
        db = join(dir, "room.sqlite"),
        initial = listFixture({ cell: true, parent }),
        block = parent ? "ap" : "bp",
        anchor = anchorAt(initial, block, 0, 4);
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const call = (input) => {
        const r = spawnSync(process.execPath, [worker, db], {
          input: JSON.stringify(input),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
        if (input.crash) {
          assert.equal(r.signal, "SIGKILL", r.stderr);
          return;
        }
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(r.stdout);
      };
      call({ kind: "seed", state: initial });
      let record = call({ kind: "read" }),
        clients = ["A", "B", "C"].map((a) => new Client(a, "disk", record));
      for (const c of clients.slice(0, 2)) {
        const point = { block, offset: 2 },
          p = planListEnter(c.state, captureRange(c.state, point, point), {
            id: `${c.actor}:disk:1`,
            actor: c.actor,
            epoch: 1,
          });
        c.prepare(p.intent);
      }
      clients[2].prepare({
        kind: "insert",
        at: gapAt(initial, block, 3),
        text: "中",
        marks: ["strong"],
      });
      clients = clients.map((c) => {
        const path = join(dir, c.actor + ".json");
        writeFileSync(path, JSON.stringify(c.save()));
        return new Client(
          c.actor,
          "disk",
          null,
          JSON.parse(readFileSync(path)),
        );
      });
      const accept = (c, crash = false) => {
        const op = structuredClone(c.pending[0]);
        if (crash) call({ kind: "submit", op, crash: true });
        const response = call({ kind: "submit", op });
        assert.equal(
          response.receipt.outcome,
          "accepted",
          response.receipt.reason,
        );
        const duplicate = call({ kind: "submit", op });
        assert.deepEqual(duplicate, response);
        record = call({ kind: "read" });
        assert.deepEqual(record, response.record);
        c.receive(record);
      };
      for (const [n, i] of order.entries()) accept(clients[i], n === 0);
      for (const c of clients) c.receive(record);
      assert.equal(record.state.revision, 3);
      assert.equal(resolveAnchor(record.state, anchor).status, "exact");
      const cuts = Object.values(record.state.listFamilies).flatMap((f) =>
        Object.keys(f.cuts),
      );
      assert.equal(cuts.length, 2);
      for (let cycle = 0; cycle < 2; cycle++) {
        for (const i of [0, 1]) {
          clients[i].undo();
          accept(clients[i], cycle === 0 && i === 0);
          for (const c of clients) c.receive(record);
        }
        assert.equal(
          text(record.state, block)
            .map((a) => a.char)
            .join(""),
          parent ? "aaa中a" : "bbb中b",
        );
        assert.deepEqual(record.state.nodes.list.children, ["a", "b", "c"]);
        for (const i of [1, 0]) {
          clients[i].redo();
          accept(clients[i]);
          for (const c of clients) c.receive(record);
        }
        assert.deepEqual(
          Object.values(record.state.listFamilies).flatMap((f) =>
            Object.keys(f.cuts),
          ),
          cuts,
        );
      }
      for (const c of clients) {
        c.undo();
        accept(c);
        for (const peer of clients) peer.receive(record);
      }
      assert.deepEqual(text(record.state, block), text(initial, block));
      assert.deepEqual(record.state.nodes.list.children, ["a", "b", "c"]);
      assert.equal(resolveAnchor(record.state, anchor).status, "exact");
      for (const c of clients) {
        assert.deepEqual(c.state, record.state);
        assert.deepEqual(c.recovery, []);
      }
    });
for (const cut of [0, 2, 4])
  for (const side of ["left", "right"])
    test(`persisted offline cut affinity cut=${cut} side=${side}`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), "jade-list-affinity-")),
        db = join(dir, "room.sqlite"),
        initial = listFixture({ cell: true, parent: false });
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const call = (input) => {
        const r = spawnSync(process.execPath, [worker, db], {
          input: JSON.stringify(input),
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
        if (input.crash) {
          assert.equal(r.signal, "SIGKILL", r.stderr);
          return;
        }
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(r.stdout);
      };
      call({ kind: "seed", state: initial });
      let record = call({ kind: "read" }),
        a = new Client("A", "disk", record),
        b = new Client("B", "disk", record);
      const accept = (c, crash = false) => {
        const op = c.pending[0];
        if (crash) call({ kind: "submit", op, crash: true });
        const result = call({ kind: "submit", op });
        assert.equal(result.receipt.outcome, "accepted", result.receipt.reason);
        assert.deepEqual(call({ kind: "submit", op }), result);
        record = result.record;
        c.receive(record);
      };
      const p = { block: "bp", offset: cut };
      a.prepare(
        planListEnter(a.state, captureRange(a.state, p, p), {
          id: "A:disk:1",
          actor: "A",
          epoch: 1,
        }).intent,
      );
      accept(a);
      b.receive(record);
      b.prepare({
        kind: "insert",
        at: gapAt(
          b.state,
          side === "left" ? "bp" : "A:disk:1:list-tail",
          side === "left" ? cut : 0,
        ),
        text: "中",
        marks: ["em"],
      });
      const outbox = join(dir, "offline.json");
      writeFileSync(outbox, JSON.stringify(b.save()));
      a.undo();
      accept(a);
      b = new Client("B", "disk", null, JSON.parse(readFileSync(outbox)));
      accept(b, true);
      a.receive(record);
      a.redo();
      accept(a);
      assert.equal(
        text(record.state, "bp")
          .map((a) => a.char)
          .join(""),
        "bbbb".slice(0, cut) + (side === "left" ? "中" : ""),
      );
      assert.equal(
        text(record.state, "A:disk:1:list-tail")
          .map((a) => a.char)
          .join(""),
        (side === "right" ? "中" : "") + "bbbb".slice(cut),
      );
      assert.equal(record.state.revision, 4);
      b.receive(record);
      assert.deepEqual(a.recovery, []);
      assert.deepEqual(b.recovery, []);
    });
