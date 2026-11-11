// SPDX-License-Identifier: MPL-2.0
import { insertionMarks, resolveRange } from "@cwhy/jade-core/selection";
// Ephemeral typing intent, not a document edit or an Undo entry. The identity
// bookmark follows remote edits, while explicit caret navigation releases it.
export class TypingStyle {
  constructor() {
    this.pending = null;
  }
  clear() {
    this.pending = null;
  }
  active(state, range, owner) {
    const p = this.pending;
    if (!p) return false;
    try {
      if (p.owner !== owner || range.kind || !range.collapsed)
        throw Error("Different typing context");
      const old = resolveRange(state, p.range),
        now = resolveRange(state, range);
      if (
        old.anchor.block !== old.focus.block ||
        old.anchor.offset !== old.focus.offset ||
        old.focus.block !== now.focus.block ||
        old.focus.offset !== now.focus.offset
      )
        throw Error("Caret moved");
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
  marks(state, range, owner) {
    return this.active(state, range, owner)
      ? structuredClone(this.pending.marks)
      : insertionMarks(state, range);
  }
  // These marks came from accepted document state, not an external clipboard.
  // Keep legacy internal color/link representations intact across Enter.
  adopt(range, owner, value) {
    this.pending = {
      range: structuredClone(range),
      owner,
      marks: structuredClone(value),
    };
  }
  toggle(state, range, owner, property) {
    if (
      !["strong", "em", "underline", "strike"].includes(property) ||
      range.kind ||
      !range.collapsed
    )
      throw Error("Typing style requires a text caret and a toggle");
    const current = this.marks(state, range, owner),
      type = (m) => (typeof m === "string" ? m : m.type),
      enabled = current.some((m) => type(m) === property),
      next = current.filter((m) => type(m) !== property);
    if (!enabled) next.push({ type: property });
    this.adopt(range, owner, next);
    return !enabled;
  }
  advance(range, owner) {
    if (this.pending?.owner === owner) {
      if (range.kind || range.collapsed === false) this.clear();
      else this.pending.range = structuredClone(range);
    }
  }
}
