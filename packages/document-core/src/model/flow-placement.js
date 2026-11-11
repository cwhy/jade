// SPDX-License-Identifier: MPL-2.0
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isList = (n) => ["ordered_list", "bullet_list"].includes(n?.type);
const plain = (n) => ["doc", "cell", "list_item"].includes(n?.type);
export function deriveFlowRegions(state, family, { parent, fail }) {
  const node = (id) => {
    const n = state.nodes[id];
    if (!n?.live) throw fail("Flow placement target is unavailable");
    return n;
  };
  // Placement regions are derived from the current tree, not frozen at the
  // first adoption. Outdent/move may change grammar without changing text order.
  // Retained home pins preserve which side of an inactive cut owns the wrapper.
  family.homePins ??= [];
  for (const r of [...(family.flowRegions || []), ...(family.regions || [])])
    if (r.kind === "list") {
      let pin = family.homePins.find((p) => p.item === r.homeItem);
      if (!pin) {
        pin = { item: r.homeItem, before: [], after: [], wrappers: {} };
        family.homePins.push(pin);
      }
      const i = r.order.indexOf("home");
      pin.before = [...new Set([...pin.before, ...r.order.slice(0, i)])];
      pin.after = [...new Set([...pin.after, ...r.order.slice(i + 1)])];
    }
  family.kind = "flow";
  family.regions = [];
  for (const block of family.layout.blocks) {
    const owner = parent(block),
      list = owner?.type === "list_item" && parent(owner.id),
      first = owner?.children[0] === block;
    if (!plain(owner)) throw fail("Unsupported flow placement");
    const kind = isList(list) && first ? "list" : "prose",
      container = kind === "list" ? list.id : owner.id;
    let r = family.regions.at(-1),
      append = r && r.kind === kind && r.container === container;
    if (append && kind === "list") {
      const prev = parent(r.members.at(-1)),
        left = list.children.indexOf(prev.id),
        right = list.children.indexOf(owner.id);
      append =
        right === left + 1 &&
        prev.children.length === 1 &&
        owner.children.length === 1;
    }
    if (append && kind === "prose")
      append =
        owner.children.indexOf(r.members.at(-1)) <
        owner.children.indexOf(block);
    if (!append) {
      r = { id: block, kind, source: block, container, members: [] };
      family.regions.push(r);
    }
    r.members.push(block);
  }
  for (const c of Object.values(family.cuts)) {
    delete c.region;
    c.wrapper ??= `${c.id}:wrapper`;
  }
  const atBlock = (id) =>
    id === family.source
      ? family.order.indexOf("home")
      : family.order.indexOf(
          Object.values(family.cuts).find((c) => c.block === id && c.active)
            ?.id,
        );
  for (const [i, r] of family.regions.entries()) {
    const start = atBlock(r.source),
      end =
        i + 1 < family.regions.length
          ? atBlock(family.regions[i + 1].source)
          : family.order.length;
    const cuts = family.order
      .slice(start + 1, end)
      .filter((id) => id !== "home");
    for (const id of cuts) family.cuts[id].region = r.id;
    if (r.kind === "prose") {
      r.parent = r.container;
      r.order = ["home", ...cuts];
      r.layout = { blocks: r.members, home: 0 };
    } else {
      const items = r.members.map((id) => parent(id)),
        pin = family.homePins.find((pin) =>
          items.some((item) => item.id === pin.item),
        ) || { item: items[0].id, before: [], after: [], wrappers: {} };
      if (!family.homePins.includes(pin)) family.homePins.push(pin);
      const home = items.findIndex((item) => item.id === pin.item),
        homeItem = items[home],
        child = state.nodes[homeItem.children[1]];
      if (homeItem.children.length > 1 && !isList(child))
        throw fail("Flow list has mixed attachments");
      let n = 0,
        index = 0;
      while (index < cuts.length) {
        const id = cuts[index],
          c = family.cuts[id];
        if (c.active) {
          if (n === home) break;
          n++;
        } else if (n === home && !pin.before.includes(id)) break;
        index++;
      }
      r.order = [...cuts.slice(0, index), "home", ...cuts.slice(index)];
      pin.wrappers ??= {};
      const active = cuts.filter((id) => family.cuts[id].active);
      for (const [i, item] of items.entries())
        if (i !== home) pin.wrappers[active[i < home ? i : i - 1]] = item.id;
      r.wrappers = { ...pin.wrappers };
      r.homeItem = pin.item;
      r.list = r.container;
      r.rest = homeItem.children.slice(1);
      r.childList = isList(child) ? child.id : null;
      r.layout = {
        blocks: r.members,
        home,
        parentItems: items.map((i) => i.id),
        childItems: [],
      };
      r.placements = Object.fromEntries(
        items.map((item) => [item.id, item.placement ?? null]),
      );
    }
    delete r.members;
    delete r.container;
  }
}

export function validateFlowFamily(state, f) {
  const known = (id) => typeof id === "string" && !!f.cuts[id];
  const order = (value) =>
    Array.isArray(value) &&
    value.filter((id) => id === "home").length === 1 &&
    new Set(value).size === value.length &&
    value.every((id) => id === "home" || known(id));
  if (f.homePins !== undefined) {
    if (
      !Array.isArray(f.homePins) ||
      new Set(f.homePins.map((p) => p.item)).size !== f.homePins.length
    )
      throw Error("Invalid flow home pins");
    for (const p of f.homePins)
      if (
        state.nodes[p.item]?.type !== "list_item" ||
        !Array.isArray(p.before) ||
        !Array.isArray(p.after) ||
        ![...p.before, ...p.after].every(known) ||
        new Set([...p.before, ...p.after]).size !==
          p.before.length + p.after.length
      )
        throw Error("Invalid flow home pin");
    for (const p of f.homePins)
      if (
        p.wrappers &&
        Object.entries(p.wrappers).some(
          ([cut, id]) => !known(cut) || state.nodes[id]?.type !== "list_item",
        )
      )
        throw Error("Invalid flow wrapper pin");
  }
  if (
    f.flowRegions !== undefined &&
    (!Array.isArray(f.flowRegions) ||
      f.flowRegions.some((r) => !order(r.order)))
  )
    throw Error("Invalid retained flow region history");
  for (const c of Object.values(f.cuts))
    if (c.separatedPlacement) {
      const p = c.separatedPlacement;
      if (
        !(p.wrapper
          ? isList(state.nodes[p.parent]) &&
            p.wrapper.id === c.wrapper &&
            state.nodes[p.wrapper.id]?.type === "list_item" &&
            p.wrapper.type === "list_item" &&
            p.wrapper.live === true &&
            same(p.wrapper.children, [p.side === "left" ? p.left : c.block]) &&
            (p.side === undefined ||
              (p.side === "left" &&
                typeof p.left === "string" &&
                !!state.nodes[p.left] &&
                state.nodes[p.home]?.type === "list_item")) &&
            typeof p.retirement === "string"
          : ["doc", "cell"].includes(state.nodes[p.parent]?.type)) ||
        ![p.after, p.before].every(
          (id) => id === null || (typeof id === "string" && !!state.nodes[id]),
        )
      )
        throw Error("Invalid separated paragraph placement");
    }
  if (f.kind !== "flow") return;
  if (
    !Array.isArray(f.regions) ||
    !f.regions.length ||
    new Set(f.regions.map((r) => r.id)).size !== f.regions.length
  )
    throw Error("Invalid flow regions");
  const flattened = [],
    owned = new Set();
  for (const r of f.regions) {
    if (
      !["prose", "list"].includes(r.kind) ||
      r.id !== r.source ||
      !order(r.order) ||
      !r.layout ||
      !Array.isArray(r.layout.blocks)
    )
      throw Error("Invalid flow region");
    const active = r.order.filter((id) => id !== "home" && f.cuts[id].active),
      home = r.order
        .slice(0, r.order.indexOf("home"))
        .filter((id) => f.cuts[id].active).length;
    if (
      !same(r.layout.blocks, [
        r.source,
        ...active.map((id) => f.cuts[id].block),
      ]) ||
      r.layout.home !== home
    )
      throw Error("Invalid flow region partition");
    for (const id of r.order)
      if (id !== "home") {
        if (owned.has(id) || f.cuts[id].region !== r.id)
          throw Error("Flow cut has conflicting region ownership");
        owned.add(id);
      }
    if (r.kind === "prose") {
      if (home !== 0 || !plain(state.nodes[r.parent]))
        throw Error("Invalid flow prose placement");
    } else if (
      !isList(state.nodes[r.list]) ||
      state.nodes[r.homeItem]?.type !== "list_item" ||
      !Array.isArray(r.rest) ||
      !Array.isArray(r.layout.parentItems) ||
      !Array.isArray(r.layout.childItems) ||
      !r.placements ||
      active.some((id) => typeof f.cuts[id].wrapper !== "string")
    )
      throw Error("Invalid flow list placement");
    if (
      r.kind === "list" &&
      (!r.wrappers ||
        active.some(
          (id) =>
            state.nodes[r.wrappers[id]]?.type !== "list_item" ||
            r.wrappers[id] === r.homeItem,
        ) ||
        new Set(active.map((id) => r.wrappers[id])).size !== active.length)
    )
      throw Error("Invalid flow wrapper assignment");
    flattened.push(...r.layout.blocks);
  }
  if (!same(flattened, f.layout.blocks))
    throw Error("Flow regions do not partition the family");
}
