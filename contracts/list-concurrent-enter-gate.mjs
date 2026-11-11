// SPDX-License-Identifier: MPL-2.0
// Full list rollout gate: both users independently press Enter in one item.
// Keep failures; do not reinterpret a rejected everyday Enter as a pass.
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { Room, Client } from "@cwhy/jade-testkit/peers";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { text, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
for (const order of [
  [0, 1],
  [1, 0],
])
  for (const reload of [false, true])
    test(`simultaneous list Enter order=${order} reload=${reload}`, () => {
      const initial = listFixture({ cell: true });
      let room = new Room(initial),
        clients = ["A", "B"].map((a) => new Client(a, "list", room.snapshot()));
      const anchor = anchorAt(initial, "bp", 0, 4);
      for (const [i, c] of clients.entries()) {
        const point = { block: "bp", offset: i ? 3 : 1 },
          plan = planListEnter(c.state, captureRange(c.state, point, point), {
            id: `${c.actor}:list:1`,
            actor: c.actor,
            epoch: 1,
          });
        c.prepare(plan.intent);
      }
      if (reload)
        clients = clients.map(
          (c) =>
            new Client(
              c.actor,
              "list",
              null,
              JSON.parse(JSON.stringify(c.save())),
            ),
        );
      for (const i of order) {
        const op = clients[i].pending[0],
          receipt = room.accept(op);
        assert.equal(receipt.outcome, "accepted", receipt.reason);
        room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
        assert.deepEqual(room.accept(op), receipt);
      }
      for (const c of clients) c.receive(room.snapshot());
      const s = room.record.state;
      assert.deepEqual(
        s.nodes.list.children.flatMap((id) =>
          s.nodes[id].children
            .filter((x) => s.nodes[x].type === "paragraph")
            .map((id) =>
              text(s, id)
                .map((a) => a.char)
                .join(""),
            ),
        ),
        ["aaaa", "b", "bb", "b", "cccc"],
      );
      assert.equal(resolveAnchor(s, anchor).status, "exact");
      for (const c of clients) {
        assert.deepEqual(c.state, s);
        assert.deepEqual(c.recovery, []);
      }
      for (const i of order) {
        const c = clients[i];
        c.receive(room.snapshot());
        c.undo();
        const receipt = room.accept(c.pending[0]);
        assert.equal(receipt.outcome, "accepted", receipt.reason);
        for (const peer of clients) peer.receive(room.snapshot());
      }
      assert.equal(
        text(room.record.state, "bp")
          .map((a) => a.char)
          .join(""),
        "bbbb",
      );
      assert.deepEqual(room.record.state.nodes.list.children, ["a", "b", "c"]);
    });
for (const cuts of [
  [0, 0],
  [0, 2],
  [2, 2],
  [1, 3],
  [2, 4],
  [4, 4],
])
  for (const parent of [false, true])
    for (const order of [
      [0, 1],
      [1, 0],
    ])
      for (const undoOrder of [
        [0, 1],
        [1, 0],
      ])
        test(`list boundaries cuts=${cuts} parent=${parent} arrival=${order} Undo=${undoOrder}`, () => {
          const initial = listFixture({ parent }),
            block = parent ? "ap" : "bp",
            source = text(initial, block),
            anchor = anchorAt(initial, block, 0, 4);
          let room = new Room(initial);
          const clients = ["A", "B"].map(
            (a) => new Client(a, "matrix", room.snapshot()),
          );
          for (const [i, c] of clients.entries()) {
            const point = { block, offset: cuts[i] },
              plan = planListEnter(
                c.state,
                captureRange(c.state, point, point),
                { id: `${c.actor}:matrix:1`, actor: c.actor, epoch: 1 },
              );
            c.prepare(plan.intent);
          }
          const accept = (c) => {
            const op = c.pending[0],
              r = room.accept(op);
            assert.equal(r.outcome, "accepted", r.reason);
            room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
            assert.deepEqual(room.accept(op), r);
            c.receive(room.snapshot());
          };
          for (const i of order) accept(clients[i]);
          for (const c of clients) c.receive(room.snapshot());
          const texts = (s) => {
            const out = [];
            const walk = (id) => {
              const n = s.nodes[id];
              if (n.text) out.push(text(s, id));
              for (const c of n.children || []) walk(c);
            };
            walk(s.root);
            return out;
          };
          const ids = new Set(source.map((a) => a.id));
          const contributions = texts(room.record.state)
            .flat()
            .filter((a) => ids.has(a.id));
          assert.deepEqual(contributions, source);
          assert.equal(
            resolveAnchor(room.record.state, anchor).status,
            "exact",
          );
          const expected = [0, ...cuts.toSorted((a, b) => a - b), 4]
            .slice(0, -1)
            .map((cut, i) =>
              source
                .slice(cut, [...cuts.toSorted((a, b) => a - b), 4][i])
                .map((a) => a.char)
                .join(""),
            );
          const sourceParagraphs = texts(room.record.state)
            .filter(
              (atoms) => !atoms.length || atoms.some((a) => ids.has(a.id)),
            )
            .map((atoms) => atoms.map((a) => a.char).join(""));
          assert.deepEqual(sourceParagraphs, expected);
          for (const i of undoOrder) {
            clients[i].receive(room.snapshot());
            clients[i].undo();
            accept(clients[i]);
            for (const c of clients) c.receive(room.snapshot());
          }
          assert.deepEqual(text(room.record.state, block), source);
          assert.deepEqual(room.record.state.nodes.list.children, [
            "a",
            "b",
            "c",
          ]);
          for (const i of undoOrder.toReversed()) {
            clients[i].redo();
            accept(clients[i]);
            for (const c of clients) c.receive(room.snapshot());
          }
          assert.deepEqual(
            texts(room.record.state)
              .flat()
              .filter((a) => ids.has(a.id)),
            source,
          );
          assert.equal(
            resolveAnchor(room.record.state, anchor).status,
            "exact",
          );
          for (const c of clients) assert.deepEqual(c.recovery, []);
        });
