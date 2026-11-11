// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureRange } from "@cwhy/jade-core/selection";
import { apply, text, gapAt } from "@cwhy/jade-core/admission";
import {
  linkContext,
  planLink,
  validateLinkURL,
  planTextFormat,
} from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, start = 2, end = 8) =>
  captureRange(
    s,
    { block: "first", offset: start },
    { block: "first", offset: end },
  );
const link = (s, c, options, a = "A", n = 1) => {
  const p = planLink(s, c, op(a, n), options);
  return { ...p, op: op(a, n, p.intent) };
};
const undo = (s, target, a = "A", n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
test("Link attaches to selected words, expands from caret, changes/removes only URL with exact Undo", () => {
  const s = tableFixture(),
    c = linkContext(s, range(s)),
    p = link(s, c, { href: "https://example.com" });
  assert.equal(
    text(p.state, "first")
      .map((a) => a.char)
      .join(""),
    "First cell text",
  );
  assert.deepEqual(p.state.nodes, s.nodes);
  assert.deepEqual(p.state.replicas, s.replicas);
  assert.ok(
    text(p.state, "first")
      .slice(2, 8)
      .every((a) => a.marks.some((m) => m.type === "link")),
  );
  const at = linkContext(p.state, range(p.state, 4, 4));
  assert.equal(at.label, "rst ce");
  assert.equal(at.href, "https://example.com");
  const b = link(p.state, at, { href: "mailto:team@example.com" }, "B"),
    back = undo(b.state, p.op.id);
  assert.ok(
    text(back, "first")
      .slice(2, 8)
      .every((a) =>
        a.marks.some((m) => m.attrs?.href === "mailto:team@example.com"),
      ),
  );
  const final = undo(back, b.op.id, "B");
  assert.deepEqual(text(final, "first"), text(s, "first"));
});
test("Link insertion and label replacement are atomic public commands with exact restoration", () => {
  const s = tableFixture(),
    empty = linkContext(s, range(s, 0, 0)),
    p = link(s, empty, { href: "https://example.com", label: "" });
  const accepted = apply(s, p.op);
  assert.deepEqual(accepted, p.state);
  assert.equal(
    text(accepted, "first")
      .map((a) => a.char)
      .join(""),
    "https://example.comFirst cell text",
  );
  assert.deepEqual(text(undo(accepted, p.op.id), "first"), text(s, "first"));
  const c = linkContext(s, range(s)),
    replace = link(s, c, { href: "https://example.com", label: "Example" });
  assert.equal(
    text(replace.state, "first")
      .map((a) => a.char)
      .join(""),
    "FiExamplell text",
  );
  assert.deepEqual(
    text(undo(replace.state, replace.op.id), "first"),
    text(s, "first"),
  );
});
test("Label replacement refuses stale content; URL-only change excludes new peer text", () => {
  const s = tableFixture(),
    c = linkContext(s, range(s)),
    n = apply(
      s,
      op("B", 1, { kind: "insert", at: gapAt(s, "first", 4), text: "peer" }),
    );
  assert.throws(
    () => link(n, c, { href: "https://example.com", label: "Replaced" }),
    /Destination changed/,
  );
  const p = link(n, c, { href: "https://example.com" });
  assert.ok(
    text(p.state, "first")
      .filter((a) => a.id.startsWith("B:"))
      .every((a) => !a.marks.length),
  );
  assert.equal(
    text(p.state, "first")
      .map((a) => a.char)
      .join(""),
    "Firspeert cell text",
  );
});
test("Remove preserves other marks, and deleted link target is refused", () => {
  const s = tableFixture(),
    r = range(s),
    bold = planTextFormat(s, r, op("seed", 1), { property: "strong" }).state,
    c = linkContext(bold, r),
    p = link(bold, c, { href: "https://example.com" }),
    remove = link(p.state, linkContext(p.state, r), { remove: true }, "A", 2);
  assert.ok(
    text(remove.state, "first")
      .slice(2, 8)
      .every((a) => a.marks.length === 1 && a.marks[0].type === "strong"),
  );
  const gone = apply(
    p.state,
    op("B", 1, { kind: "delete", ids: r.slices[0].atoms.map((a) => a.id) }),
  );
  assert.throws(
    () => link(gone, c, { href: "https://example.org" }),
    /deleted/,
  );
});
for (const url of [
  "javascript:alert(1)",
  "data:text/html,test",
  "file:///private",
  "https://",
  "https://exa mple.com",
  "mailto:",
])
  test(`Invalid link URL rejects ${url}`, () =>
    assert.throws(() => validateLinkURL(url)));
test("Code link context is rejected without modifying the source", () => {
  const s = tableFixture(),
    r = captureRange(
      s,
      { block: "code", offset: 0 },
      { block: "code", offset: 3 },
    );
  assert.throws(() => linkContext(s, r), /prose/);
});
