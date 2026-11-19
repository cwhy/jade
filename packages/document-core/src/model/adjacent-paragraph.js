// SPDX-License-Identifier: MPL-2.0
import { treeParent } from "./tree.js";
import { createReplica } from "../text/pieces.js";
import {
  registerCreation,
  attachCreation,
  reviveCreationBoundary,
} from "./creation-lifecycle.js";
export function adjacentParagraphTarget(
  state,
  block,
  side,
  fail = (message) => Error(message),
) {
  const node = state.nodes[block],
    parent = treeParent(state, block);
  if (
    !node?.live ||
    ![
      "paragraph",
      "code",
      "image",
      "table",
      "bullet_list",
      "ordered_list",
    ].includes(node.type) ||
    !parent?.live ||
    !["doc", "cell", "list_item"].includes(parent.type) ||
    !["before", "after"].includes(side)
  )
    throw fail("Block boundary is unavailable");
  return { node, parent };
}
export function executeAdjacentParagraph(state, intent, action, host) {
  return executeAdjacentLeaf(state, intent, action, host, "paragraph");
}
export function executeAdjacentCode(state, intent, action, host) {
  if (state.nodes[intent.block]?.type !== "paragraph")
    throw host.fail("Code insertion requires a paragraph boundary");
  return executeAdjacentLeaf(
    state,
    { ...intent, side: "after" },
    action,
    host,
    "code",
  );
}
function executeAdjacentLeaf(state, intent, action, host, type) {
  reviveCreationBoundary(state, intent.block, host);
  const { node, parent } = adjacentParagraphTarget(
      state,
      intent.block,
      intent.side,
      host.fail,
    ),
    id = action + ":" + type,
    text = id + ":text";
  if (state.nodes[id] || state.replicas[text])
    throw host.fail("Paragraph identity reused");
  let scope = parent;
  while (!["doc", "cell"].includes(scope.type))
    scope = treeParent(state, scope.id);
  host.write("nodes")[id] = { id, type, live: true, text };
  host.write("replicas")[text] = createReplica(text, id, [], action);
  host.remember(text + ":empty", id, 0);
  registerCreation(
    state,
    {
      id: action,
      kind: type,
      root: id,
      members: [id],
      children: [],
      parent: parent.id,
      scope: scope.id,
      clearOwner: scope.clearOwner ?? null,
      sourceInverse: { kind: "batch", intents: [] },
      sourceApplied: true,
      contentApplied: true,
      contentInverse: { kind: "batch", intents: [] },
      holds: {},
      after: null,
      before: null,
      boundary: { anchor: node.id, side: intent.side },
      acceptedAt: state.revision + 1,
    },
    host,
  );
  attachCreation(state, state.creations[action], host);
  return { kind: "creationActive", creation: action, active: false };
}
