// SPDX-License-Identifier: MPL-2.0
import { creationProseParent } from "./creation-extent.js";
import { deriveFlowRegions } from "./flow-placement.js";
// Historical text partition order is independent of current paragraph/list
// placement. Public commands still enter through semantic admission.
import { concatPieces, slicePieces } from "../text/pieces.js";
import { compareErasedBoundaries } from "./boundaries.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isList = (n) => ["ordered_list", "bullet_list"].includes(n?.type);
const plain = (n) => ["doc", "cell", "list_item"].includes(n?.type);
export function needsFlow(state, intent, parent, resolve) {
  const f =
    intent.kind === "listBoundaryActive"
      ? state.listFamilies[intent.family]
      : Object.values(state.listFamilies).find((f) =>
          f.layout.blocks.includes(resolve(intent.at).block),
        );
  return (
    f?.kind === "flow" ||
    (f?.kind === "prose" &&
      (intent.kind === "listEnter" ||
        (!creationProseParent(state, f, parent) &&
          f.layout.blocks.some((id) => parent(id)?.id !== f.parent))))
  );
}
export function executeFlowBoundary(state, intent, action, host, ordinary) {
  const { parent, resolve, fail, write, remember, repartition } = host;
  const existing =
    intent.kind === "listBoundaryActive"
      ? state.listFamilies[intent.family]
      : Object.values(state.listFamilies).find((f) =>
          f.layout.blocks.includes(resolve(intent.at).block),
        );
  let family = structuredClone(existing);
  const node = (id) => {
    const n = state.nodes[id];
    if (!n?.live) throw fail("Flow partition is unavailable");
    return n;
  };
  const set = (id, patch) => {
    write("nodes")[id] = { ...state.nodes[id], ...patch };
  };
  const setChildren = (id, children) => set(id, { children });
  // Returning all paragraphs to one ordinary parent permits the old boundary
  // inverse to run normally. Region-local cuts keep their historical identity.
  const owners = family.layout.blocks.map((id) => parent(id));
  if (
    family.kind === "flow" &&
    intent.kind !== "listEnter" &&
    owners.every((n) => n?.id === family.parent) &&
    ["doc", "cell"].includes(owners[0]?.type)
  ) {
    family.flowRegions = family.regions;
    delete family.regions;
    family.kind = "prose";
    write("listFamilies")[family.id] = family;
    return ordinary(state, intent, action, host);
  }
  deriveFlowRegions(state, family, host);
  const oldLayout = family.layout,
    sourceNodes = oldLayout.blocks.map(node),
    base = new Map();
  let total = 0;
  for (const n of sourceNodes) {
    base.set(n.id, total);
    total += state.replicas[n.text].length;
  }
  const absolute = (id) => {
    const m = state.boundaries[id];
    if (!m || !base.has(m.block)) throw fail("Flow marker left its lineage");
    return base.get(m.block) + m.offset;
  };
  // Validate only regions participating in this family; independent siblings
  // stay intact. A migration/attachment is not silently treated as an Enter.
  for (const r of family.regions) {
    if (r.kind === "prose") {
      const owner = node(r.parent),
        members = new Set(r.layout.blocks);
      if (
        !plain(owner) ||
        !same(
          owner.children.filter((id) => members.has(id)),
          r.layout.blocks,
        ) ||
        r.layout.blocks.some((id) => parent(id)?.id !== owner.id)
      )
        throw fail("Flow prose placement changed");
    } else {
      const owner = node(r.list),
        home = node(r.homeItem),
        start = owner.children.indexOf(r.layout.parentItems[0]);
      if (
        start < 0 ||
        !same(
          owner.children.slice(start, start + r.layout.parentItems.length),
          r.layout.parentItems,
        ) ||
        !same(home.children, [r.layout.blocks[r.layout.home], ...r.rest])
      )
        throw fail("Flow list placement changed");
      for (const [id, token] of Object.entries(r.placements))
        if ((node(id).placement ?? null) !== token)
          throw fail("Flow wrapper moved");
      for (const [i, block] of r.layout.blocks.entries())
        if (i !== r.layout.home) {
          const owner = parent(block);
          if (!same(owner.children, [block]))
            throw fail("Flow wrapper acquired attachments");
        }
      if (
        r.childList &&
        !same(
          node(r.childList).children.slice(0, r.layout.childItems.length),
          r.layout.childItems,
        )
      )
        throw fail("Flow child placement changed");
    }
  }
  let cut,
    region,
    placementOverride = false;
  if (intent.kind === "listBoundaryActive") {
    cut = family.cuts[intent.boundary];
    region = family.regions.find((r) => r.id === cut?.region);
    if (!cut || cut.active === intent.active)
      throw fail("Flow cut activation changed");
    if (
      (!region ||
        (region.kind === "list" && cut.wrapper === region.homeItem)) &&
      !intent.active
    ) {
      // Cross-region removal may retire only the paragraph and optional wrapper
      // created by this cut. It cannot erase an intervening leaf or foreign item.
      const i = oldLayout.blocks.indexOf(cut.block),
        left = oldLayout.blocks[i - 1],
        right = cut.block,
        owner = parent(right),
        wrapper = owner?.type === "list_item" ? owner : null,
        container = wrapper && parent(wrapper.id),
        plainRight = ["doc", "cell"].includes(owner?.type);
      const leaves = [];
      function walk(id) {
        const n = node(id);
        if (n.text || n.type === "image") leaves.push(id);
        for (const c of n.children || []) walk(c);
      }
      walk(state.root);
      const scope = (id) => {
        let n = node(id);
        while (n && !["doc", "cell"].includes(n.type)) n = parent(n.id);
        return n?.id;
      };
      const ownedWrapper =
        wrapper &&
        wrapper.id === cut.wrapper &&
        same(wrapper.children, [right]) &&
        isList(container) &&
        container.children.length > 1;
      const leftOwner = parent(left),
        leftContainer = leftOwner && parent(leftOwner.id),
        ownedLeft =
          leftOwner?.id === cut.wrapper &&
          same(leftOwner.children, [left]) &&
          isList(leftContainer) &&
          leftContainer.children.length > 1 &&
          wrapper?.children[0] === right;

      if (
        i < 1 ||
        !(plainRight || ownedWrapper || ownedLeft) ||
        leaves[leaves.indexOf(right) - 1] !== left ||
        scope(left) !== scope(right)
      )
        throw fail(
          "Cross-region Undo would remove intervening content or a foreign wrapper",
        );
      const hostNode = ownedLeft
          ? leftContainer
          : plainRight
            ? owner
            : container,
        unit = ownedLeft ? leftOwner.id : plainRight ? right : wrapper.id,
        at = hostNode.children.indexOf(unit);
      cut.separatedPlacement = {
        parent: hostNode.id,
        after: hostNode.children[at - 1] ?? null,
        before: hostNode.children[at + 1] ?? null,
        neighbours: {
          preceding: hostNode.children.slice(0, at),
          following: hostNode.children.slice(at + 1),
        },
        ...(ownedLeft
          ? {
              wrapper: structuredClone(leftOwner),
              retirement: action,
              side: "left",
              left,
              home: wrapper.id,
            }
          : ownedWrapper
            ? { wrapper: structuredClone(wrapper), retirement: action }
            : {}),
      };
      setChildren(
        hostNode.id,
        hostNode.children.filter((id) => id !== unit),
      );
      if (ownedWrapper)
        set(wrapper.id, { live: false, children: [], retiredBy: action });
      if (ownedLeft) {
        set(leftOwner.id, { live: false, children: [], retiredBy: action });
        setChildren(wrapper.id, [left, ...wrapper.children.slice(1)]);
      }
      placementOverride = true;
    } else if (intent.active && cut.separatedPlacement) {
      // Redo uses surviving neighbours from the prior placement. Retired peers
      // may disappear through independent Undo; live moved peers are a conflict.
      // A restored cut in the same text lineage can supply the left boundary.
      const place = cut.separatedPlacement,
        owner = node(place.parent),
        liveNeighbours = (ids) =>
          ids.filter((id) => {
            if (!state.nodes[id]?.live) return false;
            if (parent(id)?.id !== owner.id)
              throw fail("Separated paragraph neighbour moved");
            return true;
          }),
        after = place.neighbours
          ? (liveNeighbours(place.neighbours.preceding).at(-1) ?? null)
          : place.after,
        before = place.neighbours
          ? (liveNeighbours(place.neighbours.following)[0] ?? null)
          : place.before,
        originalAt =
          before === null
            ? owner.children.length
            : owner.children.indexOf(before),
        wrapper = place.wrapper;
      let at = originalAt,
        lineagePlacement = false;
      if (!wrapper && (at < 0 || (owner.children[at - 1] ?? null) !== after)) {
        // A different cut in this same text lineage may have been restored
        // first. Follow the retained marker's current paragraph, but only at
        // the end of its scope child and before the surviving right witness.
        // Foreign intervening structure still requires review.
        const block = state.boundaries[cut.marker]?.block;
        let root = state.nodes[block];
        while (root && parent(root.id)?.id !== owner.id) root = parent(root.id);
        let last = root;
        while (last?.children?.length) last = state.nodes[last.children.at(-1)];
        const candidate = root ? owner.children.indexOf(root.id) + 1 : -1;
        if (
          oldLayout.blocks.includes(block) &&
          last?.id === block &&
          candidate > 0 &&
          (owner.children[candidate] ?? null) === before
        ) {
          at = candidate;
          lineagePlacement = true;
        }
      }
      if (
        !(wrapper ? isList(owner) : ["doc", "cell"].includes(owner.type)) ||
        at < 0 ||
        (!lineagePlacement && (owner.children[at - 1] ?? null) !== after)
      )
        throw fail(
          "Separated paragraph restoration acquired a structural dependency",
        );
      if (place.side === "left") {
        const home = node(place.home);
        if (home.children[0] !== place.left)
          throw fail("Owned left split restoration acquired a dependency");
        setChildren(home.id, [cut.block, ...home.children.slice(1)]);
      }
      if (wrapper) {
        const current = state.nodes[wrapper.id];
        if (current?.live || current?.retiredBy !== place.retirement)
          throw fail("Owned split wrapper lifecycle changed");
        write("nodes")[wrapper.id] = structuredClone(wrapper);
      }
      const children = [...owner.children];
      children.splice(at, 0, wrapper?.id ?? cut.block);
      setChildren(owner.id, children);
      placementOverride = true;
    }
    if (!region && !placementOverride)
      throw fail(
        "Cross-region boundary requires restored placement before Undo",
      );
    if (!placementOverride && region.kind === "prose" && !intent.active) {
      const i = region.layout.blocks.indexOf(cut.block),
        children = node(region.parent).children;
      if (
        i < 1 ||
        children[children.indexOf(cut.block) - 1] !==
          region.layout.blocks[i - 1]
      )
        throw fail("Flow Undo crosses intervening structure");
    }
    if (
      !placementOverride &&
      !intent.active &&
      region.kind === "list" &&
      cut.wrapper === region.homeItem
    )
      throw fail(
        "Split wrapper became a moved home item; restore its placement before Undo",
      );
    cut.active = intent.active;
  } else {
    const at = resolve(intent.at);
    region = family.regions.find((r) => r.layout.blocks.includes(at.block));
    if (!region) throw fail("Flow Enter left its placement region");
    const active = region.order.filter(
        (id) => id !== "home" && family.cuts[id].active,
      ),
      part = region.layout.blocks.indexOf(at.block),
      position = absolutePoint(at),
      previous = part ? active[part - 1] : null,
      next = active[part] ?? null;
    let lo = previous ? region.order.indexOf(previous) + 1 : 0,
      hi = next ? region.order.indexOf(next) : region.order.length;
    const home = region.order.indexOf("home"),
      beforeHome =
        region.kind === "list" &&
        (part < region.layout.home ||
          (part === region.layout.home && at.offset === 0));
    if (beforeHome) hi = Math.min(hi, home);
    else lo = Math.max(lo, home + 1);
    const id = `${action}:cut`,
      marker = `${action}:flow-cut`;
    remember(marker, at.block, at.offset, intent.at);
    let index = lo;
    while (index < hi) {
      const prior = family.cuts[region.order[index]].marker,
        n = absolute(prior);
      if (
        n > position ||
        (n === position && compareErasedBoundaries(state, prior, marker) > 0)
      )
        break;
      index++;
    }
    const after = region.order.slice(index).find((id) => id !== "home"),
      globalPart = oldLayout.blocks.indexOf(region.source),
      globalActive = family.order.filter(
        (id) => id !== "home" && family.cuts[id].active,
      ),
      end = globalActive[globalPart + region.layout.blocks.length - 1];
    const globalIndex = after
      ? family.order.indexOf(after)
      : end
        ? family.order.indexOf(end)
        : family.order.length;
    cut = {
      id,
      marker,
      block:
        intent.kind === "listEnter"
          ? `${action}:list-tail`
          : `${action}:paragraph`,
      wrapper: `${action}:list-item`,
      region: region.id,
      active: true,
    };
    family.cuts[id] = cut;
    family.order.splice(globalIndex, 0, id);
    region.order.splice(index, 0, id);
  }
  function absolutePoint(at) {
    return base.get(at.block) + at.offset;
  }
  const active = family.order.filter(
      (id) => id !== "home" && family.cuts[id].active,
    ),
    blocks = [family.source, ...active.map((id) => family.cuts[id].block)],
    offsets = active.map((id) => absolute(family.cuts[id].marker)),
    pieces = concatPieces(
      ...sourceNodes.map((n) => state.replicas[n.text].pieces),
    ),
    cuts = [0, ...offsets, total];
  if (offsets.some((n, i) => n < 0 || n > total || (i && n < offsets[i - 1])))
    throw fail("Flow cut order changed");
  for (const id of blocks)
    if (!state.nodes[id])
      write("nodes")[id] = { id, type: "paragraph", live: false };
  repartition(
    oldLayout.blocks,
    blocks.map((block, i) => ({
      block,
      pieces: slicePieces(pieces, cuts[i], cuts[i + 1]),
    })),
    action,
    active.map((id, i) => ({
      marker: family.cuts[id].marker,
      right: blocks[i + 1],
    })),
  );
  for (const c of Object.values(family.cuts)) {
    const { edge, ...marker } = state.boundaries[c.marker],
      i = active.indexOf(c.id);
    write("boundaries")[c.marker] =
      i < 0
        ? marker
        : { ...marker, block: blocks[i + 1], offset: 0, edge: "start" };
  }
  for (const id of oldLayout.blocks)
    if (!blocks.includes(id)) set(id, { live: false });
  if (placementOverride) {
    family.layout = { blocks, home: 0 };
    deriveFlowRegions(state, family, host);
  } else {
    for (const r of family.regions) {
      const active = r.order.filter(
          (id) => id !== "home" && family.cuts[id].active,
        ),
        local = [r.source, ...active.map((id) => family.cuts[id].block)],
        home = r.order
          .slice(0, r.order.indexOf("home"))
          .filter((id) => family.cuts[id].active).length;
      if (r.kind === "prose") {
        const old = new Set(r.layout.blocks),
          groups = new Map();
        let group;
        for (const id of local) {
          if (old.has(id)) {
            group = [];
            groups.set(id, group);
          }
          group.push(id);
        }
        setChildren(
          r.parent,
          node(r.parent).children.flatMap((id) =>
            old.has(id) ? groups.get(id) || [] : [id],
          ),
        );
        r.layout = { blocks: local, home: 0 };
      } else {
        const owner = node(r.list),
          homeNode = node(r.homeItem),
          start = owner.children.indexOf(r.layout.parentItems[0]),
          before = [],
          after = [],
          placements = {};
        // Repartitioning text is not an explicit move. Preserve the placement
        // owner so an ordinary Undo/Redo cycle cannot look like a competing drag.
        for (const [i, block] of local.entries())
          if (i !== home) {
            const c = family.cuts[active[i < home ? i : i - 1]],
              id = r.wrappers[c.id] ?? c.wrapper;
            r.wrappers[c.id] = id;
            const placement = state.nodes[id]?.placement ?? c.id;
            write("nodes")[id] = {
              ...state.nodes[id],
              id,
              type: "list_item",
              live: true,
              children: [block],
              placement,
            };
            placements[id] = placement;
            (i < home ? before : after).push(id);
          }
        const retained = new Set([...before, r.homeItem, ...after]);
        for (const id of [...r.layout.parentItems, ...r.layout.childItems])
          if (!retained.has(id)) set(id, { live: false, children: [] });
        const parentItems = [
          ...before,
          r.homeItem,
          ...(r.childList ? [] : after),
        ];
        setChildren(r.list, [
          ...owner.children.slice(0, start),
          ...parentItems,
          ...owner.children.slice(start + r.layout.parentItems.length),
        ]);
        setChildren(r.homeItem, [local[home], ...r.rest]);
        placements[r.homeItem] = homeNode.placement ?? null;
        if (r.childList)
          setChildren(r.childList, [
            ...after,
            ...node(r.childList).children.slice(r.layout.childItems.length),
          ]);
        r.layout = {
          blocks: local,
          home,
          parentItems,
          childItems: r.childList ? after : [],
        };
        r.placements = placements;
      }
    }
  }
  for (const r of family.regions)
    if (r.kind === "list") {
      const pin = family.homePins.find((p) => p.item === r.homeItem),
        i = r.order.indexOf("home");
      pin.wrappers = { ...pin.wrappers, ...r.wrappers };
      pin.before = [...new Set([...pin.before, ...r.order.slice(0, i)])];
      pin.after = [...new Set([...pin.after, ...r.order.slice(i + 1)])];
    }
  family.layout = { blocks, home: 0 };
  write("listFamilies")[family.id] = family;
  return {
    kind: "listBoundaryActive",
    family: family.id,
    boundary: cut.id,
    active: !cut.active,
  };
}
