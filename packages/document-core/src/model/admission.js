// SPDX-License-Identifier: MPL-2.0
import {validateImageSize,validateImageSizes} from './image-size.js';
import {validateMedia, validateMediaState} from './media.js';
import {validateImagePlacement} from './image-placement.js';
import {validateTableCreate} from './table-creation.js';
import { validateMarkerType } from "./list-marker.js";
import { validateListNumbering } from "./list-numbering.js";
import { validateRichInsert } from "./rich-insert.js";
import { validateProseReplace } from "./prose-replace.js";
// Experimental public boundary. Primitive reducers may build intermediate
// shapes inside a command; only a complete, valid document may be published.
// This is model admission, not account authorization or production transport.
import * as engine from "./engine.js";
import { isImmutable } from "./immutable.js";
import { marks as clipboardMarks } from "../fragment.js";
import { checkFormat, propertyOf } from "../text/formatting-contributions.js";
export * from "./engine.js";
const fail = (message) => {
  throw new engine.Conflict(`Admission: ${message}`);
};
const record = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x) => typeof x === "string" && x.length > 0;
const ids = (x) =>
  Array.isArray(x) &&
  x.length > 0 &&
  x.every(id) &&
  new Set(x).size === x.length;
const blocks = new Set([
  "paragraph",
  "code",
  "image",
  "bullet_list",
  "ordered_list",
  "table",
]);
const lists = new Set(["bullet_list", "ordered_list"]);
// Every shape dependency is in the node map or root ID. Only host-proven
// transitive immutability permits reuse; mutable decoded trees always traverse.
const checkedShapes = new WeakMap();
const shapeCounts = { walks: 0, hits: 0 };
export const shapeValidationStats = () => ({ ...shapeCounts });
function checkPublicFormat(property, value) {
  try {
    checkFormat(property, value);
  } catch {
    fail("invalid formatting value");
  }
}

export function validateDocumentShape(state) {
  if (!record(state) || !record(state.nodes) || !id(state.root))
    fail("missing document tree");
  const stable = isImmutable(state.nodes) && (state.pendingMedia === undefined || isImmutable(state.pendingMedia)),
    cached = stable ? checkedShapes.get(state.nodes) : undefined,
    roots = cached?.media === state.pendingMedia ? cached?.roots : undefined;
  if (roots?.has(state.root)) {
    shapeCounts.hits++;
    return;
  }
  validateMediaState(state, fail);
  validateImageSizes(state, fail);
  shapeCounts.walks++;
  const visited = new Set();
  function walk(key, parent, inCell) {
    const n = state.nodes[key];
    if (n?.live !== true || n.id !== key || visited.has(key))
      fail("missing, repeated or mismatched node");
    visited.add(key);
    if (!parent && n.type !== "doc") fail("root must be a document");
    if (parent) {
      const allowed = lists.has(parent.type)
        ? n.type === "list_item"
        : parent.type === "table"
          ? n.type === "row"
          : parent.type === "row"
            ? n.type === "cell"
            : ["doc", "cell", "list_item"].includes(parent.type) &&
              blocks.has(n.type);
      if (!allowed) fail("invalid child kind");
    }
    if (n.type === "table" && inCell) fail("nested table");
    if (["paragraph", "code"].includes(n.type)) {
      if (!id(n.text) || Object.hasOwn(n, "children")) fail("text block shape");
      return;
    }
    if (n.type === "image") {
      if (Object.hasOwn(n, "children") || Object.hasOwn(n, "text"))
        fail("image block shape");
      return; // Upload authority remains a host responsibility.
    }
    if (
      !["doc", "cell", "row", "table", "list_item", ...lists].includes(
        n.type,
      ) ||
      !ids(n.children) ||
      Object.hasOwn(n, "text")
    )
      fail("container shape");
    if (
      n.type === "list_item" &&
      state.nodes[n.children[0]]?.type !== "paragraph"
    )
      fail("list first paragraph");
    if (
      n.type === "ordered_list" &&
      n.order !== undefined &&
      (!Number.isSafeInteger(n.order) || n.order < 1)
    )
      fail("list numbering");
    if (n.type === "table") {
      const widths = n.children.map(
        (row) => state.nodes[row]?.children?.length,
      );
      if (!widths[0] || widths.some((width) => width !== widths[0]))
        fail("ragged table");
    }
    for (const child of n.children) walk(child, n, inCell || n.type === "cell");
  }
  walk(state.root, null, false);
  for (const [key, n] of Object.entries(state.nodes))
    if (n.live && !visited.has(key)) fail("orphan node");
  if (stable) {
    const checkedRoots = roots || new Set();
    checkedRoots.add(state.root);
    checkedShapes.set(state.nodes, { roots: checkedRoots, media: state.pendingMedia });
  }
}

function checkGap(state, gap) {
  if (!record(gap)) fail("missing gap");
  if (gap.codec === 3) {
    if (!id(gap.boundary) || !Object.hasOwn(state.boundaries, gap.boundary))
      fail("unknown gap boundary");
  } else if (gap.codec === 2) {
    if (
      !id(gap.text) ||
      !Object.hasOwn(state.replicas, gap.text) ||
      !Number.isSafeInteger(gap.generation) ||
      gap.generation < 1 ||
      !Number.isSafeInteger(gap.offset) ||
      gap.offset < 0 ||
      !["left", "right"].includes(gap.affinity) ||
      ![gap.left, gap.right].every((x) => x === null || id(x))
    )
      fail("malformed text gap");
    for (const pieces of [gap.before, gap.after]) {
      if (!Array.isArray(pieces)) fail("missing gap pieces");
      for (const p of pieces)
        if (
          !record(p) ||
          !id(p.run) ||
          !Object.hasOwn(state.runs, p.run) ||
          !Number.isSafeInteger(p.from) ||
          p.from < 0 ||
          !Number.isSafeInteger(p.length) ||
          p.length < 1 ||
          p.from + p.length > state.runs[p.run].chars.length
        )
          fail("invalid gap slice");
    }
  } else fail("unknown gap codec");
  if (gap.listAffinity !== undefined) {
    if (!record(gap.listAffinity)) fail("malformed list affinity");
    const markers = new Set(
      Object.values(state.listFamilies).flatMap((f) =>
        Object.values(f.cuts).map((c) => c.marker),
      ),
    );
    for (const [marker, side] of Object.entries(gap.listAffinity))
      if (!markers.has(marker) || !["left", "right"].includes(side))
        fail("invalid list affinity");
  }
}

export function validatePublicIntent(
  state,
  intent,
  inBatch = false,
  depth = 0,
) {
  if (!record(intent) || !id(intent.kind)) fail("missing intent");
  // Defensive lab recursion cap; not a selected production workload budget.
  if (depth > 16) fail("batch nesting limit");
  for (const key of [
    "revive",
    "origin",
    "erasure",
    "restore",
    "pieces",
    "atoms",
  ])
    if (Object.hasOwn(intent, key)) fail("restoration payload is internal");
  const fields = (...keys) => {
    if (!keys.every((k) => id(intent[k]))) fail("missing operation identity");
  };
  if (intent.kind === "listEnter" && intent.marker !== undefined)
    validateMarkerType(intent.marker);
  switch (intent.kind) {
    case "listNumbering":
      if (inBatch) fail("Numbering must be a complete operation");
      validateListNumbering(state, intent);
      return;
    case 'imageResize':
      if(inBatch)fail('Image resizing must be a complete operation');
      validateImageSize(state,intent);return;
    case 'imagePlace':
      if(inBatch)fail('Media commands must be complete operations');
      checkGap(state,intent.at);
      validateImagePlacement(state,intent,{resolve:at=>engine.resolveGap(state,at),gap:(id,offset)=>engine.gapAt(state,id,offset),fail:m=>new engine.Conflict('Admission: '+m)});return;
    case 'imageInsert':
    case 'imageComplete':
    case 'imageDelete':
      if(inBatch)fail('Media commands must be complete operations');
      if(intent.kind==='imageInsert')checkGap(state,intent.at);
      validateMedia(state,intent,{resolve:at=>engine.resolveGap(state,at),fail:m=>new engine.Conflict('Admission: '+m)});return;
    case "tableCreate":
      if(inBatch)fail("Table creation must be a complete operation");
      checkGap(state,intent.at);
      validateTableCreate(state,intent,{resolve:at=>engine.resolveGap(state,at),fail:m=>new engine.Conflict("Admission: "+m)});
      return;
    case "richInsert":
      if (inBatch) fail("Rich insertion must be a complete operation");
      checkGap(state, intent.at);
      validateRichInsert(state, intent, {
        resolve: (at) => engine.resolveGap(state, at),
        fail: (m) => new engine.Conflict("Admission: " + m),
      });
      return;
    case "proseReplace":
      if (inBatch) fail("Prose replacement must be a complete operation");
      validateProseReplace(state, intent, {
        resolve: (at) => engine.resolveGap(state, at),
        find: (id) => engine.findCharacter(state, id),
        fail: (m) => new engine.Conflict("Admission: " + m),
      });
      return;
    case "tableFormat":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "table", "targets", "patch"].includes(k),
        ) ||
        !ids(intent.targets) ||
        !record(intent.patch)
      )
        fail("invalid table formatting");
      fields("table");
      return;
    case "tableDistributeColumns":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "table", "expected"].includes(k),
        ) ||
        !record(intent.expected)
      )
        fail("invalid column distribution");
      fields("table");
      return;
    case "tableMove":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) =>
            ![
              "kind",
              "table",
              "axis",
              "targets",
              "before",
              "expected",
            ].includes(k),
        ) ||
        !["rows", "columns"].includes(intent.axis) ||
        !ids(intent.targets) ||
        !(intent.before === null || id(intent.before)) ||
        !record(intent.expected)
      )
        fail("invalid table move");
      fields("table");
      return;
    case "tableResizeRow":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "table", "row", "expected", "height"].includes(k),
        ) ||
        !record(intent.expected)
      )
        fail("invalid row resize");
      fields("table", "row");
      return;
    case "tableResizeColumn":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "table", "column", "expected", "width"].includes(k),
        ) ||
        !record(intent.expected)
      )
        fail("invalid column resize");
      fields("table", "column");
      return;
    case "tableDelete":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) =>
            !["kind", "axis", "selection", "geometry", "witness"].includes(k),
        ) ||
        !["rows", "columns", "table"].includes(intent.axis) ||
        !record(intent.selection) ||
        !record(intent.geometry) ||
        !record(intent.witness)
      )
        fail("invalid table deletion");
      return;
    case "expandPasteCells":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) =>
            !["kind", "selection", "geometry", "witness", "fragment"].includes(
              k,
            ),
        ) ||
        !record(intent.selection) ||
        !record(intent.geometry) ||
        !record(intent.witness) ||
        !record(intent.fragment)
      )
        fail("invalid expanding paste");
      return;
    case "pasteCells":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "range", "witness", "fragment"].includes(k),
        ) ||
        !record(intent.range) ||
        !record(intent.witness) ||
        !record(intent.fragment)
      )
        fail("invalid cell paste");
      return;
    case "clearCells":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "range", "witness"].includes(k),
        ) ||
        !record(intent.range) ||
        !record(intent.witness)
      )
        fail("invalid cell clear");
      return;
    case "proseEnter":
      if (
        inBatch ||
        Object.keys(intent).some((k) => !["kind", "at"].includes(k))
      )
        fail("invalid paragraph Enter");
      checkGap(state, intent.at);
      return;
    case "insertBoundaryParagraph":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "parent", "table", "text"].includes(k),
        ) ||
        typeof intent.text !== "string"
      )
        fail("invalid boundary paragraph creation");
      fields("parent", "table");
      return;
    case "tableInsertColumn":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "table", "template", "before"].includes(k),
        ) ||
        !(intent.before === null || id(intent.before))
      )
        fail("invalid column insertion");
      fields("table", "template");
      return;
    case "tableInsertRow":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) =>
            !["kind", "table", "before", "template", "columns"].includes(k),
        ) ||
        !(intent.before === null || id(intent.before)) ||
        !ids(intent.columns)
      )
        fail("invalid row insertion");
      fields("table", "template");
      return;
    case "batch":
      if (!Array.isArray(intent.intents) || !intent.intents.length)
        fail("empty or malformed batch");
      for (const part of intent.intents)
        validatePublicIntent(state, part, true, depth + 1);
      for (const hold of intent.intents.filter((i) => i.kind === "listHold")) {
        const wrapper =
          state.listFamilies[hold.family]?.cuts[hold.boundary]?.wrapper;
        if (
          !intent.intents.some(
            (i) =>
              (i.kind === "treePlace" && i.node === wrapper) ||
              (i.kind === "treeWrap" && i.nodes.includes(wrapper)),
          )
        )
          fail("list hold requires its structural contribution");
      }
      return;
    case "listHold":
      if (
        !inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "family", "boundary"].includes(k),
        ) ||
        !state.listFamilies[intent.family]?.cuts[intent.boundary]?.wrapper
      )
        fail("invalid list hold");
      return;
    case "listEnter":
      checkGap(state, intent.at);
      return;
    case "insert": {
      checkGap(state, intent.at);
      const styled = Object.hasOwn(intent, "runs");
      if (styled) {
        if (
          Object.keys(intent).some(
            (k) => !["kind", "at", "runs"].includes(k),
          ) ||
          !Array.isArray(intent.runs) ||
          !intent.runs.length ||
          intent.runs.length > 100000
        )
          fail("invalid styled insertion");
        let size = 0;
        for (const run of intent.runs) {
          if (
            !record(run) ||
            Object.keys(run).some((k) => !["text", "marks"].includes(k)) ||
            typeof run.text !== "string" ||
            !run.text.length ||
            (size += run.text.length) > 100000 ||
            !Array.isArray(run.marks)
          )
            fail("invalid styled insertion run");
          try {
            clipboardMarks(run.marks);
          } catch {
            fail("invalid styled insertion marks");
          }
        }
      } else if (
        typeof intent.text !== "string" ||
        !intent.text.length ||
        (intent.marks !== undefined && !Array.isArray(intent.marks))
      )
        fail("invalid insertion");
      for (const run of styled ? intent.runs : [intent])
        for (const mark of run.marks || []) {
          if (typeof mark !== "string" && (!record(mark) || !id(mark.type)))
            fail("invalid insertion mark");
          checkPublicFormat(propertyOf(mark), mark);
        }
      return;
    }
    case "delete":
      if (!ids(intent.ids)) fail("invalid deletion identities");
      return;
    case "format":
      if (!ids(intent.ids) || !id(intent.property)) fail("invalid formatting");
      checkPublicFormat(intent.property, intent.value);
      return;
    case "undo":
      if (
        inBatch ||
        (intent.targets !== undefined
          ? !ids(intent.targets) || intent.target !== undefined
          : !id(intent.target))
      )
        fail("invalid Undo request");
      return;
    case "creationItemMove":
      if (
        inBatch ||
        Object.keys(intent).some(
          (k) => !["kind", "root", "creation", "outdent", "basis"].includes(k),
        ) ||
        !id(intent.root) ||
        !id(intent.creation) ||
        typeof intent.outdent !== "boolean" ||
        !(
          intent.basis === null ||
          (id(intent.basis) &&
            state.creationPlacements[intent.basis]?.creations[0] ===
              intent.creation)
        ) ||
        state.creations[intent.creation]?.root !== intent.root
      )
        fail("invalid whole-item placement");
      return;
    case "treeWrap":
      if (
        !inBatch ||
        (!lists.has(intent.type) && intent.type !== "list_item") ||
        !ids(intent.nodes) ||
        !Array.isArray(intent.expected) ||
        intent.expected.length !== intent.nodes.length ||
        !intent.expected.every((x) => x === null || id(x))
      )
        fail("invalid wrapper command");
      fields("id", "from");
      return;
    case "treePlace":
      if (["table", "row", "cell"].includes(state.nodes[intent.node]?.type))
        fail("table structure requires a dedicated command");
      if (
        !inBatch ||
        !(intent.before === null || id(intent.before)) ||
        !(intent.expected === null || id(intent.expected))
      )
        fail("invalid placement command");
      fields("node", "from", "parent");
      return;
    case "treePrune":
    case "treeUnwrap":
      if (!inBatch || !(intent.expected === null || id(intent.expected)))
        fail("invalid wrapper removal");
      fields("node");
      return;
    // The list-only capability deliberately does not expose legacy split/join
    // or other raw reducers. Their adapters need their own admission contract.
    default:
      fail("unsupported public operation");
  }
}

export function apply(state, op) {
  if (!record(op) || !id(op.id) || !id(op.actor))
    fail("invalid operation envelope");
  validatePublicIntent(state, op.intent);
  validateDocumentShape(state);
  const next = engine.apply(state, op, validateDocumentShape);
  validateDocumentShape(next);
  return next;
}

export function validate(state) {
  engine.validate(state);
  validateDocumentShape(state);
}
