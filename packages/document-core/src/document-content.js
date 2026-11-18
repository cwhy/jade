// SPDX-License-Identifier: MPL-2.0
// Whole-body interchange for host-owned copy/export workflows. Unlike clipboard
// slices, this does not impose clipboard-sized grids or normalize literal text.
// Account/title policy, authorization, asset bytes and publication are host work.
import { seed, text, validate } from "./model/engine.js";
import { validateDocumentShape } from "./model/admission.js";
import { runStart } from "./model/list-numbering.js";
import { CELL_STYLE_PROPERTIES } from "./model/table-format.js";
import { immutable } from "./model/immutable.js";
import { marks as validateMarks } from "./fragment.js";
const attributes = {
  doc: [],
  paragraph: [],
  code: ["language"],
  image: ["asset", "alt", "width", "height", "displayWidth"],
  ordered_list: ["order"],
  bullet_list: [],
  list_item: [],
  table: ["headerRow"],
  row: ["minHeight"],
  cell: ["colwidth", "colspan", "rowspan", ...CELL_STYLE_PROPERTIES],
};
const own = (value, key) => Object.hasOwn(value, key);
const clone = (value) => structuredClone(value);
function markerBaseline(node) {
  const base =
    node.type === "paragraph" ? node.listMarkerBase : node.markerBase;
  const override = (node.markerLayers || []).findLast(
    (layer) => layer.active,
  )?.type;
  return base === undefined && override === undefined
    ? undefined
    : {
        ...(base !== undefined ? { base } : {}),
        ...(override !== undefined ? { override } : {}),
      };
}
export function captureBodyContent(state) {
  validate(state);
  validateDocumentShape(state);
  const assets = new Set();
  function visit(id) {
    const node = state.nodes[id];
    if (!node?.live || !own(attributes, node.type))
      throw Error("Unsupported document content");
    const attrs = {};
    for (const key of attributes[node.type])
      if (own(node, key)) attrs[key] = clone(node[key]);
    if (node.type === "image") {
      if (typeof node.asset !== "string" || !node.asset) {
        const error = Error("Document contains an incomplete image");
        error.code = "MEDIA_INCOMPLETE";
        error.image = id;
        throw error;
      }
      assets.add(node.asset);
    }
    const result = { sourceId: id, type: node.type, attrs };
    if (node.text) {
      const content = [];
      let previous;
      for (const atom of text(state, id)) {
        const key = JSON.stringify(atom.marks);
        if (key === previous) content.at(-1).text += atom.char;
        else {
          content.push({ text: atom.char, marks: clone(atom.marks) });
          previous = key;
        }
      }
      result.content = content;
    }
    if (node.children) result.children = node.children.map(visit);
    if (["list_item", "paragraph"].includes(node.type)) {
      const marker = markerBaseline(node);
      if (marker) result.marker = marker;
    }
    if (node.type === "paragraph" && runStart(node) !== undefined)
      result.start = runStart(node);
    return result;
  }
  return immutable({
    version: 1,
    root: visit(state.root),
    assets: [...assets],
  });
}
// The host must supply a fresh document namespace. Only current presentation is
// seeded: no previous effects, receipts, tombstones or source Undo ownership.
export function createBodyContent(body, { namespace } = {}) {
  if (
    body?.version !== 1 ||
    body.root?.type !== "doc" ||
    typeof namespace !== "string" ||
    !/^[-\w]{1,160}$/.test(namespace)
  )
    throw Error("Invalid document body copy");
  const nodes = {},
    contents = {},
    mapping = {},
    seen = new Set();
  let sequence = 0;
  function visit(value) {
    if (
      !value ||
      typeof value.sourceId !== "string" ||
      !value.sourceId ||
      seen.has(value.sourceId) ||
      !own(attributes, value.type)
    )
      throw Error("Invalid copied content");
    if (
      Object.keys(value).some(
        (k) =>
          ![
            "sourceId",
            "type",
            "attrs",
            "content",
            "children",
            "marker",
            "start",
          ].includes(k),
      )
    )
      throw Error("Unsupported copied content field");
    seen.add(value.sourceId);
    const id = `${namespace}:node:${sequence++}`;
    Object.defineProperty(mapping, value.sourceId, {
      value: id,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (
      !value.attrs ||
      Array.isArray(value.attrs) ||
      Object.keys(value.attrs).some((k) => !attributes[value.type].includes(k))
    )
      throw Error("Unsupported copied attributes");
    const node = { id, type: value.type, live: true, ...clone(value.attrs) };
    nodes[id] = node;
    const textual = ["paragraph", "code"].includes(value.type);
    if (textual) {
      if (
        !Array.isArray(value.content) ||
        value.content.some(
          (run) =>
            typeof run?.text !== "string" ||
            !Array.isArray(run.marks) ||
            Object.keys(run).some((k) => !["text", "marks"].includes(k)),
        )
      )
        throw Error("Invalid copied text");
      for (const run of value.content) validateMarks(run.marks);
      contents[id] = clone(value.content);
    } else if (value.content !== undefined)
      throw Error("Text on a non-text node");
    if (value.children !== undefined) {
      if (!Array.isArray(value.children))
        throw Error("Invalid copied children");
      node.children = value.children.map(visit);
    }
    if (value.marker !== undefined) {
      const marker = value.marker;
      if (
        !["list_item", "paragraph"].includes(value.type) ||
        !marker ||
        Array.isArray(marker) ||
        !Object.keys(marker).length ||
        Object.keys(marker).some((k) => !["base", "override"].includes(k)) ||
        Object.values(marker).some(
          (type) => !["ordered_list", "bullet_list"].includes(type),
        )
      )
        throw Error("Invalid copied marker");
      if (marker.base !== undefined)
        node[value.type === "paragraph" ? "listMarkerBase" : "markerBase"] =
          marker.base;
      if (marker.override !== undefined)
        node.markerLayers = [
          { id: `${id}:baseline-marker`, type: marker.override, active: true },
        ];
    }
    if (value.start !== undefined) {
      if (
        value.type !== "paragraph" ||
        !Number.isSafeInteger(value.start) ||
        value.start < 1
      )
        throw Error("Invalid copied restart");
      node.listStartLayers = [
        { id: `${id}:baseline-start`, value: value.start, active: true },
      ];
    }
    return id;
  }
  const root = visit(body.root);
  if (Object.values(mapping).some((id) => seen.has(id)))
    throw Error("Copy namespace reuses source identities");
  const state = seed(nodes, contents, root);
  validateDocumentShape(state);
  // Reject forged image/asset summaries and implicit-marker mismatches by using
  // the same semantic projection as the source, not by trusting host JSON fields.
  const captured = captureBodyContent(state);
  if (JSON.stringify(captured.assets) !== JSON.stringify(body.assets))
    throw Error("Copied asset inventory changed");
  const strip = (value) => {
    const { sourceId, ...rest } = value;
    return {
      ...rest,
      ...(value.children ? { children: value.children.map(strip) } : {}),
    };
  };
  if (JSON.stringify(strip(captured.root)) !== JSON.stringify(strip(body.root)))
    throw Error("Copied content semantics changed");
  return immutable({ state, mapping });
}
