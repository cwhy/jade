// SPDX-License-Identifier: MPL-2.0
import { text } from "../model/engine.js";
import { resolveBlockRange } from "../selection/blocks.js";
import { listMarkers } from "../model/list-marker.js";
import { validateDestination, ReviewRequired } from "../selection/range.js";
import { selectionStructure } from "../selection/structure.js";
import { validateFragment, MIME, plainText, htmlText } from "../fragment.js";
import {
  validateRichSlice,
  SLICE_MIME,
  slicePlainText,
  sliceHTML,
} from "../rich-slice.js";
// Copy is read-only. Source identities, replicas, permission data and mutation
// receipts must never enter transferable content. No storage operation is added.
export function copyRange(state, input) {
  const range = validateDestination(state, input);
  if (range.collapsed) return null;
  const structure = selectionStructure(state),
    scope = (id) => {
      for (let n = state.nodes[id]; n; n = structure.parent(n.id))
        if (["doc", "cell"].includes(n.type)) return n;
    };
  const first = range.slices[0],
    last = range.slices.at(-1),
    container = scope(first.block);
  if (!container || scope(last.block)?.id !== container.id)
    throw new ReviewRequired(
      "Copy text within one container, or select whole cells",
    );
  const slices = [...range.slices];
  // A caret at the next block's beginning does not copy that block's content.
  if (slices.length > 1 && slices.at(-1).to === 0) slices.pop();
  const selected = new Map(slices.map((s) => [s.block, s]));

  // Single prose ranges retain ordinary inline-copy behavior, even in a list.
  if (range.slices.length === 1 && first.type === "paragraph") {
    const fragment = validateFragment({
      version: 1,
      blocks: [leaf(state, first)],
    });
    return {
      mime: MIME,
      fragment,
      plain: plainText(fragment),
      html: htmlText(fragment),
    };
  }
  // Choose the smallest shared container. A list-item slice needs its parent
  // list wrapper to carry numbering. Orphan ancestor scaffolds are reviewed.
  const ancestors = (id) => {
    const result = [];
    for (let n = state.nodes[id]; n; n = structure.parent(n.id)) {
      result.push(n);
      if (n.id === container.id) break;
    }
    return result;
  };
  const endAncestors = new Set(ancestors(last.block).map((n) => n.id));
  let root = ancestors(first.block).find((n) => endAncestors.has(n.id));
  if (
    root.text &&
    range.slices.length > 1 &&
    structure.parent(root.id)?.type === "list_item"
  )
    root = structure.parent(root.id);
  if (root.type === "list_item") root = structure.parent(root.id);
  const positions = new Map();
  let cursor = 0;
  function index(n) {
    positions.set(n.id, cursor++);
    for (const id of n.children || []) index(state.nodes[id]);
  }
  index(root);
  const lo = positions.get(first.block),
    hi = positions.get(last.block);
  function visit(n) {
    if (n.text)
      return selected.has(n.id) ? leaf(state, selected.get(n.id)) : null;
    if (n.type === "image") {
      if (positions.get(n.id) < lo || positions.get(n.id) > hi) return null;
      return Object.fromEntries(
        ["type", "asset", "alt", "width", "height"]
          .filter((k) => n[k] !== undefined)
          .map((k) => [k, n[k]]),
      );
    }
    if (
      !["doc", "cell", "ordered_list", "bullet_list", "list_item"].includes(
        n.type,
      )
    ) {
      // Ignore containers wholly outside the text range; never flatten a table
      // that lies between selected prose blocks into an unrelated text fragment.
      const ids = [];
      function collect(x) {
        ids.push(positions.get(x.id));
        for (const id of x.children || []) collect(state.nodes[id]);
      }
      collect(n);
      if (ids.some((p) => p >= lo && p <= hi))
        throw new ReviewRequired(
          "Copy this structure using whole-cell selection",
        );
      return null;
    }
    if (["ordered_list", "bullet_list"].includes(n.type))
      return listGroups(state, n, visit);
    const children = n.children.flatMap((id) => {
      const v = visit(state.nodes[id]);
      return v === null ? [] : Array.isArray(v) ? v : [v];
    });
    if (!children.length) return null;
    if (
      n.type === "list_item" &&
      (!selected.has(n.children[0]) || children[0].type !== "paragraph")
    )
      throw new ReviewRequired(
        "This partial ancestor selection needs structural clipboard review",
      );
    const result = { type: n.type, children };
    if (n.type === "ordered_list")
      result.order =
        (n.order || 1) +
        n.children.findIndex((id) => {
          const x = state.nodes[id];
          return x.children?.some((c) => selected.has(c) || hasSelected(c));
        });
    return result;
  }
  function hasSelected(id) {
    const n = state.nodes[id];
    return selected.has(id) || (n.children || []).some(hasSelected);
  }
  const result = visit(root),
    blocks = ["doc", "cell"].includes(root.type)
      ? result?.children
      : Array.isArray(result)
        ? result
        : [result];
  if (!blocks?.length || blocks.some((b) => !b))
    throw new ReviewRequired("No transferable selection");
  if (blocks.every((b) => b.type === "paragraph")) {
    const fragment = validateFragment({ version: 1, blocks });
    return {
      mime: MIME,
      fragment,
      plain: plainText(fragment),
      html: htmlText(fragment),
    };
  }
  const fragment = validateRichSlice({
    version: 1,
    blocks,
    edges: {
      start: first.from === 0 ? "boundary" : "partial",
      end:
        last.to === state.replicas[state.nodes[last.block].text].length ||
        last.to === 0
          ? "boundary"
          : "partial",
    },
  });
  return {
    mime: SLICE_MIME,
    fragment,
    plain: slicePlainText(fragment),
    html: sliceHTML(fragment),
  };
}

function leaf(state, s) {
  const n = state.nodes[s.block],
    content = [];
  for (const atom of s.atoms) {
    const marks = (atom.marks || []).map((m) =>
      typeof m === "string"
        ? { type: m }
        : {
            type: m.type,
            ...(m.attrs
              ? { attrs: structuredClone(m.attrs) }
              : ["highlight", "color"].includes(m.type)
                ? { attrs: { color: m.color } }
                : m.type === "link"
                  ? { attrs: { href: m.href } }
                  : {}),
          },
    );
    const previous = content.at(-1);
    if (previous && JSON.stringify(previous.marks) === JSON.stringify(marks))
      previous.text += atom.char;
    else content.push({ text: atom.char, marks });
  }
  return {
    type: n.type,
    content,
    ...(n.type === "code" && n.language !== undefined
      ? { language: n.language }
      : {}),
  };
}

function listGroups(state, list, visit) {
  const groups = [];
  for (const marker of listMarkers(state, list.id)) {
    const item = visit(state.nodes[marker.id]);
    if (!item) continue;
    let group = groups.at(-1);
    if (
      !group ||
      group.type !== marker.type ||
      (marker.type === "ordered_list" &&
        marker.number !== group.order + group.children.length)
    ) {
      group = {
        type: marker.type,
        children: [],
        ...(marker.type === "ordered_list" ? { order: marker.number } : {}),
      };
      groups.push(group);
    }
    group.children.push(item);
  }
  return groups.length ? groups : null;
}

// Explicit whole-block copy includes every descendant, including final media.
// It is read-only and produces transferable content, never model identities.
export function copyBlocks(state, selection) {
  const range = resolveBlockRange(state, selection),
    selected = new Set(range.blocks);
  function block(n) {
    if (n.text) return leaf(state, { block: n.id, atoms: text(state, n.id) });
    if (n.type === "image")
      return Object.fromEntries(
        ["type", "asset", "alt", "width", "height"]
          .filter((k) => n[k] !== undefined)
          .map((k) => [k, n[k]]),
      );
    if (["ordered_list", "bullet_list"].includes(n.type))
      return listGroups(state, n, block);
    if (n.type === "list_item")
      return {
        type: n.type,
        children: n.children.flatMap((id) => block(state.nodes[id])),
      };
    throw new ReviewRequired("Copy this structure using whole-cell selection");
  }
  const parent = state.nodes[range.parent];
  const blocks = ["ordered_list", "bullet_list"].includes(parent.type)
    ? listGroups(state, parent, (n) => (selected.has(n.id) ? block(n) : null))
    : range.blocks.flatMap((id) => block(state.nodes[id]));
  const fragment = validateRichSlice({
    version: 1,
    edges: { start: "boundary", end: "boundary" },
    blocks,
  });
  return {
    mime: SLICE_MIME,
    fragment,
    plain: slicePlainText(fragment),
    html: sliceHTML(fragment),
  };
}
