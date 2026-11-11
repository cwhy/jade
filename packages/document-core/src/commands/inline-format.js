// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { marks } from "../fragment.js";
export const inlineProperties = [
  "strong",
  "em",
  "underline",
  "strike",
  "highlight",
  "color",
  "link",
];
export function summarizeFormat(atoms, property) {
  if (!inlineProperties.includes(property))
    throw Error("Unsupported text format");
  const values = atoms.map(
    (a) =>
      a.marks.find((m) => (typeof m === "string" ? m : m.type) === property) ??
      null,
  );
  const key = (v) => JSON.stringify(v === null ? null : marks([v])[0]);
  return {
    ids: atoms.map((a) => a.id),
    enabled: values.length > 0 && values.every((v) => v !== null),
    mixed: values.length > 0 && values.some((v) => key(v) !== key(values[0])),
    empty: atoms.length === 0,
    value:
      values.length && values.every((v) => key(v) === key(values[0]))
        ? values[0]
        : null,
  };
}
export function planInlineFormat(
  state,
  selection,
  op,
  atoms,
  { property, value },
) {
  const reset = property === "resetColors",
    clear = property === "clearFormat";
  const current = summarizeFormat(atoms, reset || clear ? "color" : property);
  if (current.empty) return { intent: null, state, selection };
  let intent;
  if (reset || clear) {
    if (value !== undefined) throw Error("Clear formatting takes no value");
    intent = {
      kind: "batch",
      intents: (reset ? ["color", "highlight"] : inlineProperties).map(
        (property) => ({
          kind: "format",
          ids: current.ids,
          property,
          value: null,
        }),
      ),
    };
  } else {
    if (["highlight", "color", "link"].includes(property)) {
      if (value === undefined) throw Error("Choose a formatting value or none");
      if (value !== null) value = marks([value])[0];
      if (value !== null && value.type !== property)
        throw Error("Formatting property mismatch");
    } else {
      if (value !== undefined) throw Error("Text style is a toggle");
      value = current.enabled ? null : { type: property };
    }
    intent = { kind: "format", ids: current.ids, property, value };
  }
  return { intent, state: apply(state, { ...op, intent }), selection };
}
