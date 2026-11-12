// SPDX-License-Identifier: MPL-2.0
import { treeParent } from "./tree.js";
import { locations } from "./locations.js";
import { validateMedia, executeMedia } from "./media.js";

// One semantic command owns erasure, a paragraph cut and the upload slot.
// Reuse text claims/partition identities; never copy suffix text into new atoms.
export function validateImagePlacement(state, intent, host) {
  const { resolve, fail } = host;
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "at", "ids", "slot", "width", "height"].includes(k),
    ) ||
    !Array.isArray(intent.ids) ||
    intent.ids.some((id) => typeof id !== "string" || !id) ||
    new Set(intent.ids).size !== intent.ids.length
  )
    throw fail("Invalid image placement");
  const point = resolve(intent.at),
    parent = treeParent(state, point.block);
  if (
    state.nodes[point.block]?.type !== "paragraph" ||
    !["doc", "cell"].includes(parent?.type)
  )
    throw fail("Image placement requires a body or cell paragraph");
  // Descriptor validation is shared with ordinary paragraph-end insertion.
  validateMedia(
    state,
    {
      kind: "imageInsert",
      at: host.gap(
        point.block,
        state.replicas[state.nodes[point.block].text].length,
      ),
      slot: intent.slot,
      width: intent.width,
      height: intent.height,
    },
    host,
  );
  const positions = intent.ids.length ? locations(state) : null;
  for (const id of intent.ids) {
    const found = positions.get(id);
    if (
      found &&
      (state.nodes[found.block]?.type !== "paragraph" ||
        treeParent(state, found.block)?.id !== parent.id)
    )
      throw fail("Image replacement crosses a container");
  }
  return { point, parent };
}
export function executeImagePlacement(state, intent, action, host) {
  validateImagePlacement(state, intent, host);
  const inverse = [];
  if (intent.ids.length)
    inverse.unshift(
      host.execute({ kind: "delete", ids: intent.ids }, action + ":erase"),
    );
  const at = host.resolve(intent.at);
  inverse.unshift(
    host.execute(
      { kind: "proseEnter", at: host.gap(at.block, at.offset) },
      action + ":cut",
    ),
  );
  const tail = action + ":cut:paragraph";
  const imageInverse = executeMedia(
    state,
    {
      kind: "imageInsert",
      at: host.gap(at.block, state.replicas[state.nodes[at.block].text].length),
      slot: intent.slot,
      width: intent.width,
      height: intent.height,
    },
    action,
    host,
  );
  // Redo follows the restored cut even if a peer split the prefix in between.
  inverse.unshift({ ...imageInverse, before: tail });
  return { kind: "batch", intents: inverse };
}
