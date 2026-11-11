// SPDX-License-Identifier: MPL-2.0
// A creation's structural extent follows certified paragraph lineage. It does
// not own a peer cut or absorb arbitrary neighbouring blocks. Text ownership,
// visibility and the author activity of each cut remain separate ledgers.
export function creationExtent(state, r, fail) {
  const fs = Object.values(state.listFamilies).filter((f) =>
    r.members.includes(f.source),
  );
  if (fs.length > 1)
    throw fail("Created extent spans unsupported paragraph families");
  const f = fs[0];
  if (!f)
    return {
      f: null,
      roots: [r.root],
      members: r.members,
      children: r.children,
      cutMembers: [],
      lineageMembers: [],
    };
  const lineageMembers = [
    f.source,
    ...Object.values(f.cuts).map((c) => c.block),
  ];
  if (f.kind) {
    if (
      !["prose", "flow"].includes(f.kind) ||
      (f.kind === "flow" &&
        f.regions?.some((region) => region.kind !== "prose"))
    )
      throw fail("Created extent changed its paragraph grammar");
    const children = r.children.flatMap((id) =>
      id === f.source ? f.layout.blocks : [id],
    );
    const members = [...new Set([...r.members, ...f.layout.blocks])];
    return {
      f,
      roots: [r.root],
      members,
      children,
      cutMembers: [r.root, ...f.layout.blocks],
      lineageMembers,
    };
  }
  if (f.homeItem !== r.root || f.list !== r.parent)
    throw fail("Created forest changed its retained family scope");
  const roots = f.layout.parentItems;
  const members = [
    ...new Set([
      ...r.members,
      ...f.layout.blocks,
      ...f.layout.parentItems,
      ...f.layout.childItems,
      ...(f.generatedChildList ? [f.childList] : []),
    ]),
  ];
  const children = [
    f.layout.blocks[f.layout.home],
    ...(f.generatedChildList && state.nodes[f.childList]?.live
      ? [f.childList]
      : []),
    ...f.rest,
  ];
  if (children.some((id) => !members.includes(id)))
    throw fail("Created forest acquired an unrelated structural dependency");
  return {
    f,
    roots,
    members,
    children,
    cutMembers: [
      ...f.layout.blocks,
      ...f.layout.parentItems,
      ...f.layout.childItems,
      ...(f.generatedChildList && state.nodes[f.childList].live
        ? [f.childList]
        : []),
    ],
    lineageMembers,
  };
}

// A cached unwrap inverse is a materialization detail. Reconstruct the current
// subject from its certified extent before restoring that subject's wrapper.
// Existing members retain their ownership checks. New members need lineage;
// retired members may disappear only through the same known paragraph family.
export function extentRestoration(state, inverse, creations, fail) {
  if (inverse.kind === "batch")
    return {
      ...inverse,
      intents: inverse.intents.map((i) =>
        extentRestoration(state, i, creations, fail),
      ),
    };
  if (inverse.kind !== "treeRestore" || inverse.mode !== "wrap") return inverse;
  const r = creations
    .map((id) => state.creations[id])
    .find((r) => r.root === inverse.node);
  if (!r) return inverse;
  const extent = creationExtent(state, r, fail);
  if (!extent.f?.kind) return inverse;
  const previous = new Map(
      inverse.children.map((c, i) => [
        c.id,
        {
          child: c,
          expected: inverse.childExpected
            ? inverse.childExpected[i]
            : inverse.expected,
        },
      ]),
    ),
    known = new Set(extent.lineageMembers);
  for (const id of previous.keys())
    if (
      !extent.children.includes(id) &&
      (!known.has(id) ||
        state.nodes[id]?.live ||
        state.nodes[id]?.clearedBy ||
        state.nodes[id]?.structureDeletedBy)
    )
      throw fail("Created extent lost an independent structural member");
  const childExpected = [],
    children = extent.children.map((id, i) => {
      const prior = previous.get(id);
      if (prior) {
        childExpected.push(prior.expected);
        return prior.child;
      }
      if (!known.has(id) || !state.nodes[id]?.live)
        throw fail("Unknown member in created extent");
      const placement = state.nodes[id].placement ?? null;
      childExpected.push(placement);
      return {
        id,
        parent: inverse.node,
        before: extent.children[i + 1] ?? null,
        placement,
      };
    });
  return { ...inverse, children, childExpected };
}

// A prose cut retains its grammar when an adopted creation is rewrapped.
// Only that creation's own wrapper can serve as a list-item prose container.
export function creationProseContainer(state, source, owner) {
  const n = state.nodes[source],
    r = n?.creation && state.creations[n.creation];
  return (
    !!r &&
    r.members.includes(source) &&
    !!owner &&
    ((owner.id === r.root && owner.type === "list_item") ||
      (owner.id === r.scope && ["doc", "cell"].includes(owner.type)))
  );
}
export function creationProseParent(state, family, parent) {
  const owner = parent(family.source);
  return creationProseContainer(state, family.source, owner) &&
    family.layout.blocks.every((id) => parent(id)?.id === owner.id)
    ? owner
    : null;
}
