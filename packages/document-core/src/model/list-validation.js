// SPDX-License-Identifier: MPL-2.0
import { creationProseContainer } from "./creation-extent.js";
import { validateFlowFamily } from "./flow-placement.js";
import { isImmutable } from "./immutable.js";
const checked = new WeakMap();
export function validateListFamilies(state) {
  const families = state.listFamilies;
  if (!families || typeof families !== "object" || Array.isArray(families))
    throw Error("Missing list-boundary registry");
  const prior = checked.get(families);
  if (
    isImmutable(families) &&
    prior?.nodes === state.nodes &&
    prior?.boundaries === state.boundaries
  )
    return;
  const blocks = new Set(),
    wrappers = new Set(),
    markers = new Set();
  for (const [id, f] of Object.entries(families)) {
    if (
      f?.kind === "flow" ||
      f?.homePins !== undefined ||
      f?.flowRegions !== undefined
    )
      validateFlowFamily(state, f);
    if (
      !f ||
      f.id !== id ||
      typeof f.source !== "string" ||
      (["prose", "flow"].includes(f.kind)
        ? typeof f.parent !== "string" ||
          !(
            ["doc", "cell"].includes(state.nodes[f.parent]?.type) ||
            creationProseContainer(state, f.source, state.nodes[f.parent])
          )
        : typeof f.homeItem !== "string" ||
          typeof f.list !== "string" ||
          !Array.isArray(f.rest)) ||
      !f.cuts ||
      !Array.isArray(f.order) ||
      f.order.filter((x) => x === "home").length !== 1 ||
      new Set(f.order).size !== f.order.length
    )
      throw Error("Invalid logical list family");
    if (
      !["prose", "flow"].includes(f.kind) &&
      f.childList &&
      !f.rest?.includes(f.childList) &&
      !f.generatedChildList
    )
      throw Error("Missing generated child list ownership");
    if (f.generatedChildList !== undefined) {
      const child = state.nodes[f.childList];
      if (
        f.generatedChildList !== true ||
        f.kind ||
        !["ordered_list", "bullet_list"].includes(child?.type) ||
        !Array.isArray(child.children) ||
        child.live !== !!child.children.length ||
        !f.rest?.length ||
        f.rest.includes(f.childList) ||
        !f.rest.every((id) => ["code", "image"].includes(state.nodes[id]?.type))
      )
        throw Error("Invalid generated attachment child list");
    }
    const order = f.order.filter((x) => x !== "home");
    if (
      order.length !== Object.keys(f.cuts).length ||
      order.some((x) => !Object.hasOwn(f.cuts, x))
    )
      throw Error("Invalid list cut order");
    const active = order.filter((x) => f.cuts[x].active),
      home = f.order
        .slice(0, f.order.indexOf("home"))
        .filter((x) => f.cuts[x].active).length;
    if (
      !f.layout ||
      !Array.isArray(f.layout.blocks) ||
      f.layout.home !== home ||
      JSON.stringify(f.layout.blocks) !==
        JSON.stringify([f.source, ...active.map((x) => f.cuts[x].block)]) ||
      (["prose", "flow"].includes(f.kind)
        ? home !== 0
        : !Array.isArray(f.layout.parentItems) ||
          !Array.isArray(f.layout.childItems) ||
          !f.placements)
    )
      throw Error("Invalid list partition layout");
    for (const [cutId, c] of Object.entries(f.cuts)) {
      if (c.ownerActive !== undefined || c.holds !== undefined) {
        if (
          typeof c.ownerActive !== "boolean" ||
          !Array.isArray(c.holds) ||
          !c.holds.length ||
          c.holds.some(
            (h) =>
              typeof h.id !== "string" ||
              !h.id ||
              typeof h.active !== "boolean",
          ) ||
          new Set(c.holds.map((h) => h.id)).size !== c.holds.length ||
          c.active !== (c.ownerActive || c.holds.some((h) => h.active))
        )
          throw Error("Invalid list structural holds");
      }

      if (
        c.id !== cutId ||
        typeof c.active !== "boolean" ||
        typeof c.block !== "string" ||
        (!["prose", "flow"].includes(f.kind) &&
          typeof c.wrapper !== "string") ||
        typeof c.marker !== "string" ||
        !state.boundaries[c.marker] ||
        !state.nodes[c.block] ||
        (!["prose", "flow"].includes(f.kind) && !state.nodes[c.wrapper]) ||
        blocks.has(c.block) ||
        (!["prose", "flow"].includes(f.kind) && wrappers.has(c.wrapper)) ||
        markers.has(c.marker)
      )
        throw Error("Invalid or reused list boundary identity");
      blocks.add(c.block);
      if (!["prose", "flow"].includes(f.kind)) wrappers.add(c.wrapper);
      markers.add(c.marker);
    }
  }
  if (
    isImmutable(families) &&
    isImmutable(state.nodes) &&
    isImmutable(state.boundaries)
  )
    checked.set(families, { nodes: state.nodes, boundaries: state.boundaries });
}
