// SPDX-License-Identifier: MPL-2.0
// Experimental shared logical-text read/point boundary. No renderer-only state.
import {
  captureDisplayJoin,
  needsDisplayBoundary,
} from "./model/display-boundary.js";
import { documentView } from "./document/read.js";
import { resolveGap } from "./model/engine.js";
import { conversionView, bodyConversionFor } from "./model/text-conversion.js";
import { boundaryJoinIntent, joinTarget } from "./model/join-ledger.js";
export const logicalBlocks = conversionView;
export function logicalPointAt(state, parent, id, offset, affinity = "right") {
  const view = documentView(state),
    group = view.node(id);
  if (
    !group ||
    view.parent(id)?.id !== parent ||
    !["paragraph", "code"].includes(group.type) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > view.length(id)
  )
    throw Error("Invalid logical text point");
  return { parent, at: documentView(state).gapAt(id, offset, affinity) };
}
export function resolveLogicalPoint(state, point) {
  const view = documentView(state),
    at = view.resolveGap(point.at);
  if (view.parent(at.block)?.id !== point.parent)
    throw Error("Logical point left its container");
  return { ...at, parent: point.parent, type: view.node(at.block).type };
}
export function planLogicalEnter(state, point) {
  const resolved = resolveLogicalPoint(state, point);
  if (resolved.type === "code")
    return { kind: "insert", at: point.at, text: "\n" };
  if (resolved.type !== "paragraph") throw Error("Enter requires text");
  const source = resolveGap(state, point.at).block;
  const conversion = bodyConversionFor(state, source);
  if (
    state.nodes[source].type === "paragraph" &&
    !(conversion?.scope || conversion?.origins)
  )
    return { kind: "proseEnter", at: point.at };
  if (conversion?.target !== "paragraph")
    throw Error("Body source has no conversion witness");
  return { kind: "logicalEnter", at: point.at, conversion: conversion.id };
}

// Collapsed deletion within a logical block. Outer block navigation/joins belong
// to the caller; a null result never authorizes consuming an adjacent block.
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
export function planLogicalDelete(state, point, direction) {
  if (!["backward", "forward"].includes(direction))
    throw Error("Invalid deletion direction");
  const resolved = resolveLogicalPoint(state, point),
    view = documentView(state),
    group = view.group(resolved.block),
    content = view.text(resolved.block);
  const offset = resolved.offset;
  if (direction === "backward" ? offset === 0 : offset === content.length)
    return null;
  let from = 0;
  for (const { segment } of graphemes.segment(
    content.map((a) => a.char).join(""),
  )) {
    const to = from + [...segment].length;
    if (
      direction === "backward"
        ? from < offset && offset <= to
        : from <= offset && offset < to
    ) {
      const tokens = content.slice(from, to);
      if (tokens.some((t) => t.boundary)) {
        if (tokens.length !== 1 || !tokens[0].right)
          throw Error("Unsupported structural grapheme");
        const index = group.blocks.indexOf(tokens[0].right),
          left = group.blocks[index - 1],
          right = tokens[0].right;
        return needsDisplayBoundary(state, left, right)
          ? captureDisplayJoin(state, point.parent, left, right)
          : boundaryJoinIntent(state, joinTarget(state, right));
      }
      return { kind: "delete", ids: tokens.map((t) => t.id) };
    }
    from = to;
  }
  throw Error("No grapheme at logical point");
}
