// SPDX-License-Identifier: MPL-2.0
import { treeParent } from "./tree.js";
import { deriveFlowRegions } from "./flow-placement.js";

// Rich insertion needs real prose/list containers, not a display-only wrapper.
// Promote the affected layout to the existing mixed-flow model once; text cuts
// and their ownership survive, and ordinary rich insertion can own its forest.
export function materializeImageFlowForRichInsert(state, intent, host) {
  if (intent.kind !== "richInsert") return;
  const point = host.resolveState(state, intent.at),
    item = treeParent(state, point.block),
    list = item && treeParent(state, item.id),
    record = Object.values(state.imageFlows || {}).find(
      (r) =>
        !r.materialized && r.baseList === list?.id && r.scope === intent.parent,
    );
  if (item?.type !== "list_item" || !record) return;
  const families = Object.values(state.listFamilies).filter((f) =>
    f.layout.blocks.some(
      (id) => treeParent(state, treeParent(state, id)?.id)?.id === list.id,
    ),
  );
  host.projectList(list.id);
  state.imageFlowProjection = null;
  for (const original of families) {
    const family = structuredClone(original);
    if (family.kind !== "flow") {
      family.homePins = [
        {
          item: family.homeItem,
          before: family.order.slice(0, family.order.indexOf("home")),
          after: family.order.slice(family.order.indexOf("home") + 1),
          wrappers: Object.fromEntries(
            Object.values(family.cuts).map((c) => [c.id, c.wrapper]),
          ),
        },
      ];
      family.order = ["home", ...family.order.filter((id) => id !== "home")];
      family.layout = { blocks: family.layout.blocks, home: 0 };
      family.parent = record.scope;
    }
    deriveFlowRegions(state, family, {
      parent: (id) => treeParent(state, id),
      fail: host.fail,
    });
    host.write("listFamilies")[family.id] = family;
  }
  for (const r of Object.values(state.imageFlows))
    if (r.baseList === list.id)
      host.write("imageFlows")[r.id] = { ...r, materialized: true };
}

export function placeMaterializedImages(state, records, host) {
  for (const scopeId of new Set(records.map((r) => r.scope))) {
    const local = records.filter((r) => r.scope === scopeId),
      scope = state.nodes[scopeId];
    if (!scope?.live && local.every((r) => !state.nodes[r.image]?.live))
      continue;
    const ids = new Set(local.map((r) => r.image));
    const children = scope.children.filter((id) => !ids.has(id)),
      events = new Map();
    for (const r of local
      .filter((r) => r.active && state.nodes[r.image]?.live)
      .sort((a, b) => a.acceptedAt - b.acceptedAt)) {
      const cut = r.cut && state.listFamilies[r.family]?.cuts[r.cut],
        block = cut ? cut.block : host.resolveState(state, r.at).block;
      if (r.cut && !cut?.active)
        throw host.fail("Materialized image lost its boundary");
      let root = state.nodes[block];
      while (root && treeParent(state, root.id)?.id !== scopeId)
        root = treeParent(state, root.id);
      if (!root || !root.live)
        throw host.fail("Materialized image position unavailable");
      const index = children.indexOf(root.id);
      if (index < 0) throw host.fail("Materialized image scope changed");
      const key = root.id + (cut || r.side === "before" ? ":before" : ":after");
      events.set(key, [...(events.get(key) || []), r.image]);
    }
    // Emit each boundary's images in accepted order. Repeated insertion at
    // rootIndex + 1 would reverse images sharing an after-boundary.
    host.write("nodes")[scopeId] = {
      ...scope,
      children: children.flatMap((id) => [
        ...(events.get(id + ":before") || []),
        id,
        ...(events.get(id + ":after") || []),
      ]),
    };
  }
}
