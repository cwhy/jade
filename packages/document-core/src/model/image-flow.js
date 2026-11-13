// SPDX-License-Identifier: MPL-2.0
// Image layout is a projection over canonical list cuts. It is never an Undo
// snapshot of another author's tree. Only this module writes the projection.
import { treeParent } from "./tree.js";
import { itemMarker, listMarkers } from "./list-marker.js";
import { validateMedia, createMediaImage } from "./media.js";
import { deriveFlowRegions } from "./flow-placement.js";

// Visible text insertion changes replicas and retained boundary positions, not
// the list topology cached by this projection. Joins and creation revival have
// their own topology projections and must still take the rebuilding path.
export function canReuseImageFlow(state, intent, resolve) {
  if (
    !state.imageFlowProjection ||
    intent.kind !== "insert" ||
    state.joinProjection?.length
  )
    return false;
  const block = resolve(state, intent.at).block,
    node = state.nodes[block];
  return (
    node?.live &&
    node.type === "paragraph" &&
    !node.creation &&
    !node.creationHidden
  );
}

export function canonicalImageView(state) {
  const cache = state.imageFlowProjection;
  if (!cache?.nodes) return state;
  const nodes = { ...state.nodes };
  for (const [id, n] of Object.entries(cache.nodes)) {
    if (n === null) delete nodes[id];
    else nodes[id] = n;
  }
  return {
    ...state,
    nodes,
    listFamilies: { ...state.listFamilies, ...cache.families },
  };
}
export function suspendImageFlow(state, write) {
  const cache = state.imageFlowProjection;
  if (!cache?.nodes) return;
  for (const [id, n] of Object.entries(cache.nodes)) {
    if (n === null) delete write("nodes")[id];
    else write("nodes")[id] = n;
  }
  Object.assign(write("listFamilies"), cache.families);
  state.imageFlowProjection = null;
}
export function imageFlowTarget(state, at, resolve) {
  const s = canonicalImageView(state),
    point = resolve(s, at),
    item = treeParent(s, point.block),
    list = item && treeParent(s, item.id),
    scope = list && treeParent(s, list.id);
  if (
    s.nodes[point.block]?.type !== "paragraph" ||
    item?.type !== "list_item" ||
    item.children.length !== 1 ||
    list?.type !== "ordered_list" ||
    itemMarker(s, item.id) !== "ordered_list" ||
    !["doc", "cell"].includes(scope?.type)
  )
    return null;
  return { state: s, point, item, list, scope };
}
export function validateImageFlow(state, intent, host) {
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "at", "slot", "width", "height"].includes(k),
    )
  )
    throw host.fail("Invalid image flow");
  const target = imageFlowTarget(state, intent.at, host.resolveState);
  if (!target)
    throw host.fail("Image flow requires a retained leaf numbered paragraph");
  const s = target.state;
  validateMedia(
    s,
    {
      kind: "imageInsert",
      at: host.gapState(
        s,
        target.point.block,
        s.replicas[s.nodes[target.point.block].text].length,
      ),
      slot: intent.slot,
      width: intent.width,
      height: intent.height,
    },
    { resolve: (at) => host.resolveState(s, at), fail: host.fail },
  );
  return target;
}
export function executeImageFlow(state, intent, action, host) {
  if (intent.kind === "imageFlowActive") {
    const r = state.imageFlows[intent.flow];
    if (!r || r.active === intent.active)
      throw host.fail("Image flow activity changed");
    const inverse = host.execute(r.inverse, action + ":owned");
    host.write("imageFlows")[r.id] = { ...r, active: intent.active, inverse };
    return { ...intent, active: !intent.active };
  }
  const { point, item, list, scope } = validateImageFlow(state, intent, host),
    inverse = [];
  let family = null,
    cut = null;
  // A second insertion at the same retained boundary depends on the boundary,
  // not on its creator staying active. Existing cut holds provide that ownership.
  const shared = Object.values(state.imageFlows || {}).find(
    (r) =>
      r.active &&
      r.cut &&
      state.listFamilies[r.family]?.cuts[r.cut]?.active &&
      state.listFamilies[r.family].cuts[r.cut].block === point.block &&
      point.offset === 0,
  );
  if (shared) {
    ({ family, cut } = shared);
    inverse.unshift(
      host.execute(
        { kind: "listHold", family, boundary: cut },
        action + ":hold",
      ),
    );
  } else if (
    point.offset > 0 &&
    point.offset < state.replicas[state.nodes[point.block].text].length
  ) {
    inverse.unshift(
      host.execute(
        { kind: "listEnter", at: intent.at, marker: "ordered_list" },
        action + ":cut",
      ),
    );
    const f = Object.values(state.listFamilies).find(
      (f) => f.cuts[action + ":cut:cut"],
    );
    family = f.id;
    cut = action + ":cut:cut";
  }
  inverse.unshift({
    ...createMediaImage(
      state,
      intent,
      action,
      state.nodes[scope.id],
      null,
      host,
      null,
    ),
    after: null,
  });
  host.write("imageFlows")[action] = {
    id: action,
    image: action + ":image",
    baseList: list.id,
    scope: scope.id,
    source: point.block,
    item: item.id,
    side: point.offset === 0 ? "before" : "after",
    at: intent.at,
    family,
    cut,
    active: true,
    acceptedAt: state.revision,
    inverse: { kind: "batch", intents: inverse },
  };
  return { kind: "imageFlowActive", flow: action, active: false };
}

export function projectImageFlow(state, host) {
  const records = Object.values(state.imageFlows || {});
  if (!records.length) return;
  const cache = { nodes: {}, families: {} },
    write = (id, n) => {
      if (!Object.hasOwn(cache.nodes, id))
        cache.nodes[id] = state.nodes[id] ?? null;
      host.write("nodes")[id] = n;
    };
  const active = records
    .filter((r) => r.active && state.nodes[r.image]?.live)
    .sort((a, b) => a.acceptedAt - b.acceptedAt);
  for (const listId of new Set(records.map((r) => r.baseList))) {
    const list = state.nodes[listId],
      scope = list && treeParent(state, listId);
    // A deleted container retains its flow ownership for Undo, but has no
    // visible projection. Never recreate content while its retirement is live.
    if (
      !list?.live &&
      (list?.clearedBy || list?.structureDeletedBy) &&
      records
        .filter((r) => r.baseList === listId)
        .every((r) => !state.nodes[r.image]?.live)
    )
      continue;
    if (!list?.live || !["doc", "cell"].includes(scope?.type))
      throw host.fail("Image flow list scope changed");
    const localImages = new Set(
      records.filter((r) => r.baseList === listId).map((r) => r.image),
    );
    const events = new Map(),
      plain = new Set();
    for (const r of active.filter((r) => r.baseList === listId)) {
      let block = r.source,
        side = r.side;
      if (r.cut) {
        const c = state.listFamilies[r.family]?.cuts[r.cut];
        if (!c?.active) throw host.fail("Image flow lost its boundary");
        block = c.block;
        side = "before";
        plain.add(block);
      } else block = host.resolveState(state, r.at).block;
      // Indenting an endpoint's item does not make its separate cell image an
      // item attachment. Keep that image outside the containing top-level item.
      let owner = treeParent(state, block);
      while (owner && treeParent(state, owner.id)?.id !== listId)
        owner = treeParent(state, owner.id);
      if (!owner || owner.type !== "list_item")
        throw host.fail("Image flow anchor left its admitted list");
      if (owner.children[0] !== block) {
        block = owner.children[0];
        side = "after";
      }
      const key = block + ":" + side;
      events.set(key, [...(events.get(key) || []), r.image]);
    }
    const output = [],
      groups = [];
    let group = null,
      number = listMarkers(state, listId)[0]?.number ?? 1;
    const emitImages = (key) => {
      for (const image of events.get(key) || []) {
        group = null;
        output.push(image);
      }
    };
    for (const itemId of list.children) {
      const item = state.nodes[itemId],
        block = item.children[0],
        p = state.nodes[block];
      emitImages(block + ":before");
      if (p.imageFlowKind === "paragraph" || plain.has(block)) {
        group = null;
        output.push(block);
        write(itemId, { ...item, live: false, children: [] });
      } else {
        if (!group) {
          const id = groups.length ? listId + ":image-run:" + itemId : listId;
          group = { ...list, id, order: number, children: [] };
          groups.push(group);
          output.push(id);
        }
        group.children.push(itemId);
        number++;
      }
      emitImages(block + ":after");
    }
    for (const g of groups) write(g.id, g);
    if (!groups.length) write(listId, { ...list, live: false, children: [] });
    write(scope.id, {
      ...scope,
      children: scope.children
        .filter((id) => !localImages.has(id))
        .flatMap((id) => (id === listId ? output : [id])),
    });
  }
  for (const original of Object.values(state.listFamilies)) {
    if (original.layout.blocks.every((id) => !state.nodes[id]?.live)) continue;
    if (
      !original.layout.blocks.some(
        (id) =>
          Object.hasOwn(cache.nodes, treeParent(state, id)?.id) ||
          records.some((r) => r.source === id || r.family === original.id),
      )
    )
      continue;
    cache.families[original.id] = original;
    const f = structuredClone(original);
    if (f.kind !== "flow") {
      if (f.kind === "prose")
        throw host.fail("Unsupported canonical prose image flow");
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
      f.parent =
        records.find((r) => r.baseList === original.list)?.scope ??
        original.parent;
    }
    deriveFlowRegions(state, f, {
      parent: (id) => treeParent(state, id),
      fail: host.fail,
    });
    host.write("listFamilies")[f.id] = f;
  }
  state.imageFlowProjection = cache;
}

// Projection caches are persisted, so they must reconstruct the published view
// exactly. They are not trusted instructions to overwrite arbitrary future nodes.
export function validateImageFlowState(state, host) {
  const records = Object.values(state.imageFlows || {});
  for (const [id, r] of Object.entries(state.imageFlows || {})) {
    if (
      !r ||
      r.id !== id ||
      typeof r.active !== "boolean" ||
      !Number.isSafeInteger(r.acceptedAt) ||
      r.acceptedAt < 0 ||
      state.nodes[r.image]?.type !== "image" ||
      !state.nodes[r.image].mediaSlot ||
      state.nodes[r.baseList]?.type !== "ordered_list" ||
      !["doc", "cell"].includes(state.nodes[r.scope]?.type) ||
      state.nodes[r.source]?.type !== "paragraph" ||
      !["before", "after"].includes(r.side) ||
      !r.inverse ||
      r.inverse.kind !== "batch" ||
      !Array.isArray(r.inverse.intents) ||
      (r.cut !== null && !state.listFamilies[r.family]?.cuts[r.cut])
    )
      throw host.fail("Invalid image flow ownership");
  }
  for (const n of Object.values(state.nodes))
    if (
      n.imageFlowKind !== undefined &&
      (n.type !== "paragraph" || n.imageFlowKind !== "paragraph")
    )
      throw host.fail("Invalid authored paragraph kind");
  if (!records.length) {
    if (state.imageFlowProjection)
      throw host.fail("Image projection without ownership");
    return;
  }
  if (!state.imageFlowProjection?.nodes || !state.imageFlowProjection.families)
    throw host.fail("Missing image flow projection");
  const canonical = canonicalImageView(state);
  const trial = {
    ...canonical,
    nodes: { ...canonical.nodes },
    listFamilies: { ...canonical.listFamilies },
    imageFlowProjection: null,
  };
  projectImageFlow(trial, { ...host, write: (field) => trial[field] });
  if (
    JSON.stringify(trial.nodes) !== JSON.stringify(state.nodes) ||
    JSON.stringify(trial.listFamilies) !== JSON.stringify(state.listFamilies) ||
    JSON.stringify(trial.imageFlowProjection) !==
      JSON.stringify(state.imageFlowProjection)
  )
    throw host.fail(
      "Image flow projection does not match its canonical source",
    );
}
