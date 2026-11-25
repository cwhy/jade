// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReader,
  formatEntries,
  updateFormats,
} from "../packages/document-core/src/text/format-store.js";
import { immutable } from "../packages/document-core/src/model/immutable.js";
test("interval overlays match an independent point map across gaps, runs and reload", () => {
  let store = {},
    oracle = new Map(),
    random = 12345;
  const next = () =>
    (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 4294967296;
  const values = Array.from({ length: 6 }, (_, i) => ({
    base: [],
    layers: [
      {
        id: "a:" + i,
        property: "strong",
        value: i % 2 ? "strong" : null,
        active: true,
      },
    ],
  }));
  for (let round = 0; round < 500; round++) {
    const patch = new Map();
    for (let j = 0; j < 1 + Math.floor(next() * 20); j++)
      patch.set(
        `run${Math.floor(next() * 3)}:${Math.floor(next() * 80)}`,
        values[Math.floor(next() * values.length)],
      );
    const before = JSON.stringify(store),
      prior = immutable(store);
    store = updateFormats(prior, patch);
    for (const pair of patch) oracle.set(...pair);
    assert.equal(JSON.stringify(prior), before);
    if (round % 7 === 0) store = JSON.parse(JSON.stringify(store));
    const read = formatReader(store);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 80; i++)
        assert.deepEqual(read(`run${r}:${i}`), oracle.get(`run${r}:${i}`));
    assert.deepEqual(new Map(formatEntries(store)), oracle);
  }
});
test("identical histories coalesce despite distinct object identities", () => {
  const value = {
    base: [],
    layers: [{ id: "a", property: "strong", value: "strong", active: true }],
  };
  const s = updateFormats(
    {},
    new Map(
      Array.from({ length: 40000 }, (_, i) => [
        "run:" + i,
        structuredClone(value),
      ]),
    ),
  );
  assert.equal(s.values.length, 1);
  assert.deepEqual(s.spans, [{ run: "run", from: 0, length: 40000, value: 0 }]);
  assert.ok(JSON.stringify(s).length < 300);
});
