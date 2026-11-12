// SPDX-License-Identifier: MPL-2.0
import { registerCreation } from "./creation-lifecycle.js";
import { treeParent } from "./tree.js";
import { itemMarker, listMarkers } from "./list-marker.js";
import { createReplica } from "../text/pieces.js";
import { deriveFlowRegions } from "./flow-placement.js";

// Narrow CP-09b source shape. Existing rich clipboard paths retain their guards.
export function attachedSourcePaste(state, slice, parent) {
  const list = parent && treeParent(state, parent.id),
    scope = list && treeParent(state, list.id),
    source = slice.blocks?.[0],
    item = source?.children?.[0];
  return (
    parent?.type === "list_item" &&
    parent.children.length === 1 &&
    list?.type === "ordered_list" &&
    ["doc", "cell"].includes(scope?.type) &&
    itemMarker(state, parent.id) === "ordered_list" &&
    slice.blocks.length === 1 &&
    source.type === "ordered_list" &&
    source.children.length === 1 &&
    item.children.length === 2 &&
    item.children[0].type === "paragraph" &&
    ["code", "image"].includes(item.children[1].type)
  );
}

// Resolve all intermediate identities inside the semantic command. The client
// sends no tree steps or holds referring to nodes that have not been created.
export function executeAttachedSourcePaste(state, slice, at, action, host) {
  const inverse = [],
    step = (intent, id) => inverse.unshift(host.execute(intent, id));
  const dest = treeParent(state, at.block),
    list = treeParent(state, dest.id),
    scope = treeParent(state, list.id);
  const length = state.replicas[state.nodes[at.block].text].length,
    middle = at.offset > 0 && at.offset < length;
  const originalNext =
    list.children[list.children.indexOf(dest.id) + 1] ?? null;
  let before =
    list.children[list.children.indexOf(dest.id) + (at.offset === 0 ? 0 : 1)] ??
    null;
  if (middle) {
    const cut = action + ":cut";
    step(
      {
        kind: "listEnter",
        at: host.gap(at.block, at.offset),
        marker: "ordered_list",
      },
      cut,
    );
    const suffix = cut + ":list-tail",
      wrapper = treeParent(state, suffix),
      owner = treeParent(state, wrapper.id);
    const following = owner.children.slice(
      owner.children.indexOf(wrapper.id) + 1,
    );
    let outside = scope.children[scope.children.indexOf(owner.id) + 1] ?? null;
    if (following.length) {
      const order = listMarkers(state, owner.id).find(
        (x) => x.id === following[0],
      ).number;
      const trailing = action + ":following-list";
      step(
        {
          kind: "treeWrap",
          id: trailing,
          type: "ordered_list",
          nodes: following,
          from: owner.id,
          expected: following.map((id) => state.nodes[id].placement ?? null),
        },
        action + ":wrap-following",
      );
      step(
        {
          kind: "treePlace",
          node: trailing,
          from: owner.id,
          parent: scope.id,
          before: outside,
          expected: state.nodes[trailing].placement ?? null,
        },
        action + ":place-following",
      );
      step(
        { kind: "listNumbering", list: trailing, start: order },
        action + ":following-number",
      );
      outside = trailing;
    }
    step(
      {
        kind: "treePlace",
        node: wrapper.id,
        from: owner.id,
        parent: scope.id,
        before: outside,
        expected: wrapper.placement ?? null,
      },
      action + ":lift-suffix",
    );
    step(
      {
        kind: "treeUnwrap",
        node: wrapper.id,
        expected: state.nodes[wrapper.id].placement ?? null,
      },
      action + ":unwrap-suffix",
    );
    before = null;
    const original = Object.values(state.listFamilies).find((f) =>
        f.layout.blocks.includes(suffix),
      ),
      f = structuredClone(original);
    if (f.kind !== "flow") {
      f.homePins = [
        {
          item: f.homeItem,
          before: f.order.slice(0, f.order.indexOf("home")),
          after: f.order.slice(f.order.indexOf("home") + 1),
          wrappers: Object.fromEntries(
            Object.values(f.cuts).map((c) => [c.id, c.wrapper]),
          ),
        },
      ];
      f.order = ["home", ...f.order.filter((id) => id !== "home")];
      f.layout = { blocks: f.layout.blocks, home: 0 };
      f.parent = scope.id;
    }
    deriveFlowRegions(state, f, {
      parent: (id) => treeParent(state, id),
      fail: host.fail,
    });
    host.write("listFamilies")[f.id] = f;
  }
  const itemId = action + ":attached:item",
    paragraphId = action + ":attached:paragraph",
    attachmentId = action + ":attached:attachment";
  const source = slice.blocks[0].children[0],
    created = [],
    texts = [];
  for (const [id, b] of [
    [paragraphId, source.children[0]],
    [attachmentId, source.children[1]],
  ]) {
    if (state.nodes[id]) throw host.fail("Pasted identity reused");
    const n = { id, type: b.type, live: true, richLifecycle: action };
    for (const key of ["language", "asset", "alt", "width", "height", "displayWidth"])
      if (b[key] !== undefined) n[key] = b[key];
    if (b.content) {
      n.text = id + ":text";
      host.write("replicas")[n.text] = createReplica(n.text, id, [], action);
      host.remember(n.text + ":empty", id, 0);
      texts.push({ id, content: b.content });
    }
    host.write("nodes")[id] = n;
    const { live, text, richLifecycle, ...shape } = n;
    created.push({ id, shape: { ...shape, placement: null } });
  }
  const item = {
    id: itemId,
    type: "list_item",
    live: true,
    richLifecycle: action,
    children: [paragraphId, attachmentId],
  };
  host.write("nodes")[itemId] = item;
  created.push({
    id: itemId,
    shape: {
      id: itemId,
      type: "list_item",
      children: [paragraphId, attachmentId],
      placement: null,
    },
  });
  const children = [...state.nodes[list.id].children],
    index = before === null ? children.length : children.indexOf(before);
  if (index < 0) throw host.fail("Paste destination changed");
  children.splice(index, 0, itemId);
  host.write("nodes")[list.id] = { ...state.nodes[list.id], children };
  const sourceInverse = { kind: "batch", intents: [...inverse] };
  inverse.length = 0;
  registerCreation(
    state,
    {
      id: action,
      root: itemId,
      members: created.map((n) => n.id),
      children: [paragraphId, attachmentId],
      parent: list.id,
      scope: scope.id,
      clearOwner: scope.clearOwner ?? null,
      sourceInverse,
      sourceApplied: true,
      contentApplied: true,
      contentInverse: null,
      holds: {},
      after: at.offset === 0 ? null : dest.id,
      before: at.offset === 0 ? dest.id : originalNext,
    },
    host,
  );

  for (const { id, content } of texts) {
    const runs = content.filter((r) => r.text.length);
    if (runs.length)
      step({ kind: "insert", at: host.gap(id, 0), runs }, id + ":content");
  }
  const contentInverse = { kind: "batch", intents: [...inverse] };
  inverse.length = 0;
  if (at.offset === 0)
    step(
      {
        kind: "listNumbering",
        list: list.id,
        start: slice.blocks[0].order ?? 1,
      },
      action + ":source-number",
    );
  host.write("creations")[action] = {
    ...state.creations[action],
    contentInverse,
    sourceInverse: {
      kind: "batch",
      intents: [...inverse, ...sourceInverse.intents],
    },
  };
  return { kind: "creationActive", creation: action, active: false };
}
