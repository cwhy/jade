// SPDX-License-Identifier: MPL-2.0
import { conversionProjection } from "./conversion-origins.js";
// A multi-block Body conversion preserves each effective code boundary. The
// existing section reducer makes the whole action atomic and owns its Undo.
import {
  captureConversion,
  captureScopedStyle,
  conversionLayout,
  contributionMembers,
  validateConversionReview,
} from "./text-conversion.js";
import { scopeProjection } from "./conversion-scope.js";
import { proseProjectionSources } from "./join-ledger.js";
const fail = (message) => {
  throw Error("Body sections: " + message);
};
const keys = (value, allowed) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function captureBodySections(state, parent, blocks) {
  const layout = conversionLayout(state, parent);
  const selected = layout.filter((group) =>
    group.blocks.some((id) => blocks.includes(id)),
  );
  if (selected.length < 2) return null;
  if (
    !same(
      selected.flatMap((group) => group.blocks),
      blocks,
    )
  )
    fail("Select complete blocks in document order");
  const indices = selected.map((group) => layout.indexOf(group));
  if (indices.some((index, i) => i && index !== indices[i - 1] + 1))
    fail("Select contiguous blocks");
  const parts = [],
    preserved = [];
  for (const group of selected) {
    if (group.type === "code")
      parts.push(
        captureScopedStyle(state, parent, group.blocks, "paragraph") ||
          captureConversion(state, parent, group.blocks, "paragraph"),
      );
    else if (["image", "paragraph"].includes(group.type))
      preserved.push({ id: group.id, type: group.type });
    else fail("Select code, Body and images in one container");
  }
  if (!parts.length) fail("Select code to convert to Body");
  const intent = {
    kind: "textSectionsConvert",
    target: "paragraph",
    parent,
    parts,
    preserved,
  };
  validateBodySections(state, intent);
  return intent;
}
export function validateBodySections(state, intent) {
  if (
    !keys(intent, ["kind", "target", "parent", "parts", "preserved"]) ||
    intent.kind !== "textSectionsConvert" ||
    intent.target !== "paragraph" ||
    typeof intent.parent !== "string" ||
    !Array.isArray(intent.parts) ||
    !intent.parts.length ||
    !Array.isArray(intent.preserved)
  )
    fail("Invalid Body section conversion");
  const container = state.nodes[intent.parent];
  if (!container?.live || !["doc", "cell"].includes(container.type))
    fail("Conversion container changed");
  const layout = conversionLayout(state, intent.parent),
    chosen = new Set(),
    partGroups = [],
    preservedGroups = [];
  function select(group) {
    if (!group || chosen.has(group.id))
      fail("Duplicate or missing selected block");
    chosen.add(group.id);
  }
  for (const record of intent.preserved) {
    const group = layout.find((g) => g.id === record.id);
    if (
      !keys(record, ["id", "type"]) ||
      !["paragraph", "image"].includes(record.type) ||
      !group ||
      group.type !== record.type
    )
      fail("Preserved block changed");
    select(group);
    preservedGroups.push(group.id);
  }
  for (const part of intent.parts) {
    if (
      part.kind !== "textConvert" ||
      part.parent !== intent.parent ||
      part.target !== "paragraph"
    )
      fail("Conversion section changed scope");
    validateConversionReview(state, part);
    const projection = conversionProjection(state, part);
    const ids = [
      ...new Set(
        contributionMembers(state, part).map((id) => projection.owner.get(id)),
      ),
    ];
    const group = layout.find((g) => g.blocks.includes(ids[0]));
    if (!group || group.type !== "code" || !same(group.blocks, ids))
      fail("Select one complete code block per Body paragraph");
    select(group);
    partGroups.push(group.id);
  }
  const selected = layout.filter((g) => chosen.has(g.id)),
    indices = selected.map((g) => layout.indexOf(g));
  if (indices.some((index, i) => i && index !== indices[i - 1] + 1))
    fail("Selection is no longer contiguous");
  if (
    !same(
      selected.filter((g) => g.type === "code").map((g) => g.id),
      partGroups,
    ) ||
    !same(
      selected.filter((g) => g.type !== "code").map((g) => g.id),
      preservedGroups,
    )
  )
    fail("Section order changed");
}
