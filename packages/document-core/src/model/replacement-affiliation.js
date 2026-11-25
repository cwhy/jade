// SPDX-License-Identifier: MPL-2.0
// A replacement retains its source edges independently of its active Undo state.
// Later typing keeps its authored gap for Redo; restoration can follow these
// edges back through older replacements without guessing equal-looking text.
const identity = (id) => {
  if (typeof id !== "string") return null;
  const at = id.lastIndexOf(":"),
    offset = Number(id.slice(at + 1));
  return Number.isSafeInteger(offset) && offset >= 0
    ? { run: id.slice(0, at), offset }
    : null;
};
export function replacementAffiliation(state, gap) {
  if (gap?.codec !== 2 && !gap?.text) return null;
  const left = identity(gap.left),
    right = identity(gap.right),
    l = left && state.replacementOrigins?.[left.run],
    r = right && state.replacementOrigins?.[right.run];
  if (l && left.offset < l.length)
    return {
      run: left.run,
      source: l.end,
      left: gap.left,
      right: r && right.run === left.run ? gap.right : null,
    };
  if (r && right.offset < r.length)
    return {
      run: right.run,
      source: right.offset === 0 ? r.start : r.end,
      left: null,
      right: gap.right,
    };
  return null;
}
export function validateReplacementOrigins(state) {
  const ledger = state.replacementOrigins;
  if (ledger === undefined) return;
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger))
    throw Error("Invalid replacement origins");
  for (const [run, entry] of Object.entries(ledger)) {
    if (
      !entry ||
      Object.keys(entry).sort().join(",") !== "end,length,start" ||
      !Number.isSafeInteger(entry.length) ||
      entry.length < 1 ||
      state.runs[run]?.chars.length !== entry.length
    )
      throw Error("Invalid replacement run");
    for (const gap of [entry.start, entry.end]) {
      if (
        !gap ||
        gap.codec !== 2 ||
        !state.replicas[gap.text] ||
        state.replicas[gap.text].generation !== gap.generation ||
        !Array.isArray(gap.before) ||
        !Array.isArray(gap.after)
      )
        throw Error("Invalid replacement source");
      for (const id of [gap.left, gap.right])
        if (id !== null) {
          const parsed = identity(id);
          if (
            !parsed ||
            parsed.run === run ||
            !state.runs[parsed.run]?.chars[parsed.offset]
          )
            throw Error("Invalid replacement source identity");
        }
    }
  }
  // Nested replacements form a DAG of prior source identities, never a cycle.
  const checked = new Set(),
    active = new Set();
  function visit(run) {
    if (checked.has(run)) return;
    if (active.has(run)) throw Error("Cyclic replacement origins");
    active.add(run);
    for (const gap of [ledger[run].start, ledger[run].end])
      for (const id of [gap.left, gap.right]) {
        const prior = identity(id)?.run;
        if (ledger[prior]) visit(prior);
      }
    active.delete(run);
    checked.add(run);
  }
  for (const run of Object.keys(ledger)) visit(run);
}

// Only the complete exterior of a replacement has an original outside side.
// Partial masks and ordinary inserted runs cannot authorize cross-source Undo.
export function replacementSourceEdge(state, first, last, offset, size) {
  const edge = identity(offset === 0 ? first : offset === size ? last : null);
  const entry = edge && state.replacementOrigins?.[edge.run];
  if (!entry) return null;
  if (offset === 0 && edge.offset === 0) return entry.start;
  if (offset === size && edge.offset === entry.length - 1) return entry.end;
  return null;
}
