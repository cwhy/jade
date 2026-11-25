// SPDX-License-Identifier: MPL-2.0
import { conversionProjection } from "./conversion-origins.js";
// Convert prose sections using the existing reducers; preserve code/media identities.
import {
  captureConversion,
  captureScopedStyle,
  contributionMembers,
  conversionLoss,
  validateConversionReview,
  executeConversion,
  conversionLayout,
} from "./text-conversion.js";
import { validateBodySections } from "./body-sections.js";
import { scopeProjection } from "./conversion-scope.js";
import { proseProjectionSources } from "./join-ledger.js";
const keys = (v, allowed) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k));
const barrier = (n) => ["image", "code"].includes(n?.type);
export function hasPreservedSections(state, parent, blocks) {
  return conversionLayout(state, parent).some(
    (g) => barrier(g) && g.blocks.some((id) => blocks.includes(id)),
  );
}
export function captureTextSections(state, parent, blocks) {
  const children = conversionLayout(state, parent).flatMap(
    (group) => group.blocks,
  );
  if (
    !["doc", "cell"].includes(state.nodes[parent]?.type) ||
    !Array.isArray(blocks) ||
    !blocks.length ||
    new Set(blocks).size !== blocks.length ||
    blocks.some(
      (id, i) =>
        !children.includes(id) ||
        (i && children.indexOf(id) !== children.indexOf(blocks[i - 1]) + 1),
    )
  )
    throw Error("Select contiguous text and preserved blocks in one container");
  const parts = [],
    preserved = [];
  let text = [];
  const finish = () => {
    if (text.length) {
      const part =
          captureScopedStyle(state, parent, text, "code") ||
          captureConversion(state, parent, text, "code"),
        loss = conversionLoss(state, part);
      parts.push({ ...part, ...(loss.length ? { loss } : {}) });
      text = [];
    }
  };
  for (const group of conversionLayout(state, parent)) {
    const selected = group.blocks.filter((id) => blocks.includes(id));
    if (!selected.length) continue;
    if (selected.length !== group.blocks.length)
      throw Error("Select complete logical blocks");
    if (barrier(group)) {
      finish();
      preserved.push({
        id: group.id,
        type: group.type,
        ...(group.conversion ? { conversion: group.conversion } : {}),
      });
    } else if (group.type === "paragraph") text.push(...group.blocks);
    else throw Error("Mixed conversion contains an unsupported block");
  }
  finish();
  if (!parts.length)
    throw Error("Select prose to convert; existing blocks are preserved");
  const intent = { kind: "textSectionsConvert", parent, parts, preserved };
  validateTextSections(state, intent);
  return intent;
}
export function validateTextSections(state, intent) {
  if (intent.target === "paragraph") return validateBodySections(state, intent);
  if (
    !keys(intent, ["kind", "parent", "parts", "preserved"]) ||
    intent.kind !== "textSectionsConvert" ||
    typeof intent.parent !== "string" ||
    !Array.isArray(intent.parts) ||
    !intent.parts.length ||
    !Array.isArray(intent.preserved) ||
    !intent.preserved.length
  )
    throw Error("Invalid section conversion");
  const container = state.nodes[intent.parent];
  if (!container?.live || !["doc", "cell"].includes(container.type))
    throw Error("Conversion container changed");
  const layout = conversionLayout(state, intent.parent),
    groups = new Map(layout.map((g) => [g.id, g])),
    effective = new Map(
      layout.flatMap((g) => g.blocks.map((id) => [id, g.type])),
    );
  const children = layout.flatMap((group) => group.blocks),
    preserved = new Set(),
    chosen = new Set(),
    parts = [];
  for (const record of intent.preserved) {
    const group = groups.get(record.id);
    if (
      !keys(record, ["id", "type", "conversion"]) ||
      typeof record.id !== "string" ||
      !barrier(record) ||
      !group ||
      group.type !== record.type ||
      group.conversion !== record.conversion ||
      group.blocks.some((id) => chosen.has(id) || !children.includes(id))
    )
      throw Error("Preserved conversion block changed");
    for (const id of group.blocks) {
      preserved.add(id);
      chosen.add(id);
    }
  }
  for (const part of intent.parts) {
    if (part.parent !== intent.parent || part.target !== "code")
      throw Error("Conversion section changed scope");
    validateConversionReview(state, part);
    const projected = conversionProjection(state, part);
    const ids = [
      ...new Set(
        contributionMembers(state, part).map((id) => projected.owner.get(id)),
      ),
    ];
    if (ids.some((id) => chosen.has(id) || effective.get(id) !== "paragraph"))
      throw Error("Conversion section crosses a preserved block");
    for (const id of ids) chosen.add(id);
    parts.push(ids);
  }
  const indices = [...chosen].map((id) => children.indexOf(id));
  const from = Math.min(...indices),
    to = Math.max(...indices),
    selected = children.slice(from, to + 1);
  if (from < 0 || selected.length !== chosen.size)
    throw Error("Conversion selection is no longer contiguous");
  const expected = [];
  let current = [];
  for (const id of selected) {
    if (preserved.has(id)) {
      if (current.length) expected.push(current);
      current = [];
    } else current.push(id);
  }
  if (current.length) expected.push(current);
  const preservedOrder = layout
    .filter((g) => g.blocks.some((id) => preserved.has(id)))
    .map((g) => g.id);
  if (
    JSON.stringify(expected) !== JSON.stringify(parts) ||
    JSON.stringify(preservedOrder) !==
      JSON.stringify(intent.preserved.map((p) => p.id))
  )
    throw Error("Conversion section order changed");
}
export function executeTextSections(state, intent, action, host) {
  validateTextSections(state, intent);
  const inverses = intent.parts.map((part, i) =>
    executeConversion(state, part, `${action}:section:${i}`, host),
  );
  return { kind: "batch", intents: inverses.reverse() };
}
