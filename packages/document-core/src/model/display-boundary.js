// SPDX-License-Identifier: MPL-2.0
import { sourceRecordRetired } from "./source-lifecycle.js";
// A visible cut can connect retained sources without reparenting either source.
import { conversionLayout, windowFor, members } from "./text-conversion.js";
import { conversionProjection } from "./conversion-origins.js";
import { treeParent } from "./tree.js";
const entries = (s) => s.nodes[s.root].displayJoins || [];

function retainedContainer(state, block) {
  let n = treeParent(state, block),
    scope = null;
  while (n && !["doc", "cell"].includes(n.type)) {
    scope = n.id;
    n = treeParent(state, n.id);
  }
  return { parent: n?.id, scope };
}
export function needsDisplayBoundary(state, left, right) {
  const a = retainedContainer(state, left),
    b = retainedContainer(state, right);
  return a.parent !== b.parent || a.scope !== b.scope;
}
function origin(state, parent, block, side) {
  let n = treeParent(state, block),
    scope = null;
  while (n && n.id !== parent) {
    scope = n.id;
    n = treeParent(state, n.id);
  }
  if (!n) throw Error("Display source left its visible parent");
  const projection = conversionProjection(state, { parent, scope }),
    sources = projection.sources.get(block) || [block];
  const extent = windowFor(
    state,
    side === "left" ? sources.at(-1) : sources[0],
  );
  // An edge depends on its exterior cut only, not the source's other end.
  if (side === "left") extent.left = null;
  else extent.right = null;
  return { scope, extent };
}
export function captureDisplayJoin(state, parent, left, right) {
  const intent = {
    kind: "displayJoin",
    parent,
    left: origin(state, parent, left, "left"),
    right: origin(state, parent, right, "right"),
  };
  validateDisplayJoin(state, intent);
  return intent;
}
function endpoint(state, parent, edge, side) {
  if (
    !edge ||
    Object.keys(edge).sort().join(",") !== "extent,scope" ||
    !(edge.scope === null || typeof edge.scope === "string") ||
    !edge.extent ||
    Object.keys(edge.extent).sort().join(",") !== "left,right,source" ||
    typeof edge.extent.source !== "string" ||
    ![edge.extent.left, edge.extent.right].every(
      (x) => x === null || typeof x === "string",
    )
  )
    throw Error("Malformed display source extent");
  const projection = conversionProjection(state, { parent, scope: edge.scope }),
    ids = members(state, edge.extent);
  if (!ids.length || ids.some((id) => !projection.owner.has(id)))
    throw Error("Display source extent left its origin");
  return { block: projection.owner.get(side === "left" ? ids.at(-1) : ids[0]) };
}
function endpoints(state, intent) {
  return {
    left: endpoint(state, intent.parent, intent.left, "left"),
    right: endpoint(state, intent.parent, intent.right, "right"),
  };
}
export function displayJoinBlocks(state, intent) {
  const p = endpoints(state, intent);
  return [p.left.block, p.right.block];
}
export function validateDisplayJoin(state, intent) {
  if (
    !intent ||
    Object.keys(intent).sort().join(",") !== "kind,left,parent,right" ||
    intent.kind !== "displayJoin" ||
    typeof intent.parent !== "string" ||
    !["doc", "cell"].includes(state.nodes[intent.parent]?.type)
  )
    throw Error("Invalid display boundary witness");
  const { left, right } = endpoints(state, intent),
    groups = conversionLayout(state, intent.parent),
    flat = groups.flatMap((g) => g.blocks);
  const i = flat.indexOf(right.block),
    a = groups.find((g) => g.blocks.includes(left.block)),
    b = groups.find((g) => g.blocks.includes(right.block));
  if (
    i < 1 ||
    flat[i - 1] !== left.block ||
    !a ||
    !b ||
    !(
      (a === b && ["paragraph", "code"].includes(a.type)) ||
      (a.type === "paragraph" && b.type === "paragraph")
    )
  )
    throw Error("Display boundary is not adjacent compatible text");
  if (!needsDisplayBoundary(state, left.block, right.block))
    throw Error("Use the retained canonical boundary");
  if (a === b && a.boundaries[a.blocks.indexOf(right.block) - 1]?.hidden)
    throw Error("Display boundary is already deleted");
}
export function executeDisplayJoin(state, intent, action, { write, execute, fail }) {
  const prior = entries(state),
    adding = intent.kind === "displayJoin";
  if (adding) validateDisplayJoin(state, intent);
  const old = prior.find((e) => e.id === (adding ? action : intent.target));
  if (adding ? !!old : !old) throw Error("Missing or reused display boundary");
  if (!adding && sourceRecordRetired(state,old)) throw fail("Restore retired source content before changing its boundary");
  const inverses = [];
  if (adding)
    for (const side of ["left", "right"]) {
      const w = intent[side].extent,
        cut = side === "left" ? w.right : w.left;
      if (cut !== null) {
        const f = Object.values(state.listFamilies).find(
          (f) => f.source === w.source,
        );
        inverses.push(
          execute(
            { kind: "listHold", family: f.id, boundary: cut },
            `${action}:hold:${side}`,
          ),
        );
      }
    }
  const next = adding
    ? [...prior, { ...structuredClone(intent), id: action, active: true }]
    : prior.map((e) =>
        e.id === intent.target ? { ...e, active: intent.active } : e,
      );
  write("nodes")[state.root] = {
    ...state.nodes[state.root],
    displayJoins: next,
  };
  const inverse = {
    kind: "displayJoinActive",
    target: adding ? action : intent.target,
    active: adding ? false : old.active,
  };
  return inverses.length
    ? { kind: "batch", intents: [inverse, ...inverses.reverse()] }
    : inverse;
}
export function projectDisplayJoins(state, parent, input) {
  const active = entries(state).filter((e) => e.active && !sourceRecordRetired(state,e) && e.parent === parent);
  if (!active.length) return input;
  const joins = new Map();
  for (const e of active) {
    const p = endpoints(state, e);
    joins.set(p.left.block + "\0" + p.right.block, e);
  }
  const result = [];
  for (const original of input) {
    const group = {
      ...original,
      blocks: [...original.blocks],
      boundaries: original.boundaries.map((x) => ({ ...x })),
    };
    for (let i = 1; i < group.blocks.length; i++)
      if (joins.has(group.blocks[i - 1] + "\0" + group.blocks[i]))
        group.boundaries[i - 1].hidden = true;
    const previous = result.at(-1),
      seam =
        previous && joins.get(previous.blocks.at(-1) + "\0" + group.blocks[0]);
    if (seam && previous.type === "paragraph" && group.type === "paragraph") {
      previous.boundaries.push(
        { id: seam.id, right: group.blocks[0], hidden: true },
        ...group.boundaries,
      );
      previous.blocks.push(...group.blocks);
    } else result.push(group);
  }
  return result;
}
export function validateDisplayLedger(state) {
  const ids = new Set();
  for (const e of entries(state)) {
    if (
      !e ||
      Object.keys(e).sort().join(",") !== "active,id,kind,left,parent,right" ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      typeof e.active !== "boolean" ||
      e.kind !== "displayJoin" ||
      !["doc", "cell"].includes(state.nodes[e.parent]?.type)
    )
      throw Error("Invalid display boundary ledger");
    ids.add(e.id);
    if (e.active && !sourceRecordRetired(state,e)) endpoints(state, e);
  }
}
