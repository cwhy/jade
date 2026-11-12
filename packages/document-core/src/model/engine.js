// SPDX-License-Identifier: MPL-2.0
import {executeMedia,fenceMedia} from './media.js';
import {executeImagePlacement} from './image-placement.js';
import {executeTableCreate} from './table-creation.js';
import { executeTextClaim, validateTextClaims } from "./text-claims.js";
import {
  placementBoundaryPath,
  suspendCreationPlacements,
  resumeCreationPlacements,
} from "./creation-placement-projection.js";
import { creationItemSteps } from "./item-placement.js";
import {
  beginCreationPlacement,
  finishCreationPlacement,
  executeCreationPlacementActive,
  validateCreationPlacements,
} from "./creation-placement.js";
import {
  executeCreationActive,
  prepareCreationTarget,
  projectCreations,
  validateCreations,
  creationRequiresJoinExpansion,
} from "./creation-lifecycle.js";
import {
  enterMarker,
  executeMarker,
  validateMarkers,
  validateMarkerType,
} from "./list-marker.js";
import {
  executeListNumbering,
  validateListNumberings,
  executeRunStart,
} from "./list-numbering.js";
import {
  validateRichInsert,
  executeRichInsert,
  executeRichForestActive,
} from "./rich-insert.js";
import { validateProseReplace, executeProseReplace } from "./prose-replace.js";
import {
  validateTableFormat,
  executeTableFormat,
  validateTableFormats,
} from "./table-format.js";
import {
  validateDistribution,
  executeDistribution,
} from "./column-distribution.js";
import {
  validateTableMove,
  executeTableMove,
  validateTableOrderOwners,
} from "./table-reorder.js";
import {
  validateRowResize,
  executeRowResize,
  validateRowHeightOwners,
} from "./row-resize.js";
import {
  validateColumnResize,
  executeColumnResize,
  validateColumnWidthOwners,
} from "./column-resize.js";
import {
  validateTableDelete,
  executeTableDelete,
  validateDeletedStructures,
} from "./table-deletion.js";
import {
  validateExpandingPaste,
  executeExpandingPaste,
} from "./expanding-paste.js";
import { executeTableColumn, validateTableColumns } from "./table-columns.js";
import {
  executeCellClear,
  validateClearRequest,
  assertClearTargetsAvailable,
} from "./cell-clear.js";
import {
  executeJoinContribution,
  expandJoins,
  projectJoins,
  validateJoins,
  canReuseJoinProjection,
} from "./join-ledger.js";
import { listGapAffinities } from "./list-affinity.js";
import { validateListFamilies } from "./list-validation.js";
// Paragraph/list partition operations share the current document codec.
import { executeListBoundary, executeListHold } from "./list-boundary.js";
import { treeKinds, executeTree } from "./tree.js";
import {
  executeBoundaryParagraph,
  validateBoundaryParagraphs,
} from "./boundary-paragraph.js";
import { executeTableRow, validateTableRows } from "./table-rows.js";
import {
  erasedBoundaryOrigins,
  insertionOrigin,
  restorationParts,
  originPlacement,
  erasedGapPlacement,
  restoredCutOffsets,
} from "./origins.js";
import { immutable, isImmutable } from "./immutable.js";
import { validateChanged } from "./validation.js";
import {
  addErasureBoundary,
  erasureCuts,
  clearErasure,
  rememberBoundary,
  repartitionBoundaries,
  insertAtBoundaries,
  deleteAtBoundaries,
  validateBoundaries,
} from "./boundaries.js";
import { locations as locateAtoms } from "./locations.js";
import { stage, finish, writable, erase } from "./draft.js";
import {
  contribute,
  activate,
  visible,
  checkFormat,
} from "../text/formatting-contributions.js";
import {
  createReplica,
  internAtoms,
  readPieces,
  slicePieces,
  concatPieces,
  spliceReplica,
  identities,
} from "../text/pieces.js";

export class Conflict extends Error {}
const copy = (value) => structuredClone(value);
export const textOf = (atoms) => atoms.map((a) => a.char).join("");
export function text(state, block) {
  return readPieces(
    state.runs,
    state.replicas[state.nodes[block].text].pieces,
  ).map((a) =>
    state.formats?.[a.id] ? { ...a, marks: visible(state.formats[a.id]) } : a,
  );
}

function parent(state, id) {
  return Object.values(state.nodes).find(
    (n) => n.live && n.children?.includes(id),
  );
}
function requireText(state, id) {
  const node = state.nodes[id];
  if (!node?.live || !node.text)
    throw new Conflict("Text target is no longer live");
  return node;
}
export function index(state) {
  const atoms = new Map();
  for (const n of Object.values(state.nodes)) {
    if (!n.live || !n.text) continue;
    text(state, n.id).forEach((atom, offset) => {
      if (atoms.has(atom.id)) throw new Error("Character has two live owners");
      atoms.set(atom.id, { block: n.id, offset, atom });
    });
  }
  return atoms;
}
export function gapAt(state, block, offset, affinity = "right") {
  const n = requireText(state, block),
    replica = state.replicas[n.text],
    pieces = replica.pieces;
  if (!Number.isInteger(offset) || offset < 0 || offset > replica.length)
    throw Error("Invalid character offset");
  const listAffinity = listGapAffinities(state, block, offset);
  if (replica.length === 0)
    return { codec: 3, boundary: `${n.text}:empty`, ...listAffinity };
  const before = slicePieces(pieces, 0, offset),
    after = slicePieces(pieces, offset);
  return {
    codec: 2,
    text: n.text,
    generation: replica.generation,
    offset,
    affinity,
    ...listAffinity,
    left: identities(before, true).next().value ?? null,
    right: identities(after).next().value ?? null,
    before,
    after,
  };
}
export function resolveGap(state, gap) {
  if (gap.codec === 3) {
    const cut = state.boundaries?.[gap.boundary];
    if (!cut) throw new Conflict("Unknown structural boundary");
    requireText(state, cut.block);
    return { block: cut.block, offset: cut.offset };
  }
  if (gap.codec !== 2) throw new Conflict("Incompatible gap codec");
  const locations = locateAtoms(state),
    source = state.replicas[gap.text];
  if (!source || source.generation !== gap.generation)
    throw new Conflict("Unknown text generation");
  let left = locations.get(gap.left),
    right = locations.get(gap.right);
  const missingErased =
    (!left && state.deleted[gap.left]) || (!right && state.deleted[gap.right]);
  const erased = missingErased
    ? erasedGapPlacement(state, gap, {
        atoms: (p) => readPieces(state.runs, p),
      })
    : null;
  if (
    erased &&
    ((gap.affinity === "right" && !right && state.deleted[gap.right]) ||
      (gap.affinity === "left" && !left && state.deleted[gap.left]) ||
      (!left && !right))
  )
    return erased;
  // Find surviving original neighbours, never equal-looking replacement text.
  if (!left)
    for (const id of identities(gap.before, true)) {
      left = locations.get(id);
      if (left) break;
    }
  if (!right)
    for (const id of identities(gap.after)) {
      right = locations.get(id);
      if (right) break;
    }
  if (
    right &&
    (!left || right.block === left.block || gap.affinity === "right")
  )
    return { block: right.block, offset: right.offset };
  if (left) return { block: left.block, offset: left.offset + 1 };
  if (!source.retired && state.nodes[source.owner]?.live)
    return { block: source.owner, offset: 0 };
  if (erased) return erased;
  throw new Conflict("No surviving target for this insertion");
}
export function anchorAt(state, block, from, length) {
  return {
    epoch: state.epoch,
    codec: 1,
    atoms: text(state, block)
      .slice(from, from + length)
      .map((a) => a.id),
  };
}
export function resolveAnchor(state, anchor) {
  if (anchor.epoch !== state.epoch || anchor.codec !== 1)
    return { status: "incompatible", segments: [] };
  const locations = locateAtoms(state),
    found = anchor.atoms.map((id) => locations.get(id)).filter(Boolean);
  return {
    status: !found.length
      ? "removed"
      : found.length === anchor.atoms.length
        ? "exact"
        : "partial",
    segments: found.map((x) => ({
      block: x.block,
      offset: x.offset,
      id: x.atom.id,
      char: x.atom.char,
    })),
  };
}
function updateChildren(state, owner, children) {
  writable(state, "nodes")[owner.id] = { ...owner, children };
}
function repartition(
  state,
  sourceBlocks,
  destinations,
  action,
  splitCut = null,
  listCuts = [],
  materialization = null,
) {
  const sources = sourceBlocks.map((id) => requireText(state, id));
  repartitionBoundaries(state, sourceBlocks, destinations, splitCut, listCuts);
  for (const source of sources)
    writable(state, "replicas")[source.text] = {
      ...state.replicas[source.text],
      retired: true,
    };
  if (materialization) {
    // Projection changes ownership, not authored text identity. Existing gaps
    // carry immutable atom witnesses (or an explicit empty-boundary marker),
    // so this paragraph's replica can survive a reversible materialization.
    for (const d of destinations) {
      const textId = state.nodes[d.block].text,
        prior = state.replicas[textId];
      if (!prior || prior.owner !== d.block)
        throw new Conflict("Projection partition identity missing");
      writable(state, "replicas")[textId] = {
        ...prior,
        pieces: d.pieces,
        length: d.pieces.reduce((n, p) => n + p.length, 0),
        retired: false,
      };
      writable(state, "nodes")[d.block] = {
        ...state.nodes[d.block],
        live: true,
        text: textId,
      };
      if (!d.pieces.length && !state.boundaries[`${textId}:empty`])
        rememberBoundary(state, `${textId}:empty`, d.block, 0);
    }
    return;
  }
  const targets = [];
  for (const d of destinations) {
    // Concurrent cuts can change the number/order of destinations. Replica
    // identity must follow the stable destination block, not its array index.
    const textId = "partition:" + JSON.stringify([action, d.block]);
    if (state.replicas[textId]) throw new Conflict("Text generation ID reused");
    writable(state, "replicas")[textId] = createReplica(
      textId,
      d.block,
      d.pieces,
      action,
    );
    writable(state, "nodes")[d.block] = {
      ...state.nodes[d.block],
      id: d.block,
      live: true,
      text: textId,
    };
    targets.push({ text: textId, block: d.block, pieces: d.pieces });
    if (!state.replicas[textId].length)
      rememberBoundary(state, `${textId}:empty`, d.block, 0);
  }
  writable(state, "lineage").push({
    action,
    sources: sources.map((n) => n.text),
    targets,
  });
}
function split(state, intent, action, materialization = null) {
  const at = resolveGap(state, intent.at),
    node = requireText(state, at.block),
    owner = parent(state, node.id);
  if (!owner) throw new Conflict("Missing parent");
  const pieces = state.replicas[node.text].pieces,
    tail = intent.tail;
  if (state.nodes[tail]?.live) throw new Conflict("Split target already live");
  // Reviving a joined paragraph must retain its structural placement token.
  // Otherwise the following owned tree inverse mistakes restoration for a move.
  writable(state, "nodes")[tail] = {
    ...state.nodes[tail],
    id: tail,
    type: node.type,
    live: true,
  };
  repartition(
    state,
    [node.id],
    [
      { block: node.id, pieces: slicePieces(pieces, 0, at.offset) },
      { block: tail, pieces: slicePieces(pieces, at.offset) },
    ],
    action,
    intent.at.boundary,
    materialization ? [{ marker: intent.at.boundary, right: tail }] : [],
    materialization,
  );
  if (intent.kind === "listSplit") {
    const children = state.nodes[intent.children];
    if (
      owner.type !== "list_item" ||
      owner.children[0] !== node.id ||
      owner.children[1] !== children?.id ||
      !children.live
    )
      throw new Conflict("List context changed");
    const item = intent.item || `${action}:item`;
    writable(state, "nodes")[item] = {
      id: item,
      type: "list_item",
      children: [tail],
      live: true,
    };
    updateChildren(state, children, [item, ...children.children]);
    return {
      kind: "unsplitList",
      left: node.id,
      right: tail,
      item,
      children: children.id,
    };
  }
  const siblings = [...owner.children],
    pos = siblings.indexOf(node.id);
  siblings.splice(pos + 1, 0, tail);
  updateChildren(state, owner, siblings);
  return { kind: "removeSplitBoundary", right: tail, parent: owner.id };
}
// A split owns the boundary before its tail. Other splits/Undo can replace the
// predecessor, so resolve current adjacency within the original parent.
function removeSplitBoundary(state, intent, action) {
  const right = requireText(state, intent.right),
    owner = parent(state, right.id);
  if (!owner || owner.id !== intent.parent)
    throw new Conflict("Split boundary parent changed");
  const left = owner.children[owner.children.indexOf(right.id) - 1];
  if (!left) throw new Conflict("Split boundary has no predecessor");
  return join(state, { kind: "join", left, right: right.id }, action);
}
function join(state, intent, action, materialization = null) {
  const left = requireText(state, intent.left),
    right = requireText(state, intent.right),
    owner = parent(state, left.id);
  const a = state.replicas[left.text],
    b = state.replicas[right.text];
  if (intent.kind === "unsplitList") {
    const children = state.nodes[intent.children],
      item = state.nodes[intent.item];
    if (
      !children?.live ||
      !item?.live ||
      item.children.length !== 1 ||
      item.children[0] !== right.id ||
      children.children[0] !== item.id ||
      owner.children[1] !== children.id
    )
      throw new Conflict("List split acquired a structural dependency");
    updateChildren(state, children, children.children.slice(1));
    writable(state, "nodes")[item.id] = { ...item, live: false };
  } else {
    if (
      !owner ||
      parent(state, right.id)?.id !== owner.id ||
      owner.children.indexOf(right.id) !== owner.children.indexOf(left.id) + 1
    )
      throw new Conflict("Join targets are not adjacent");
    updateChildren(
      state,
      owner,
      owner.children.filter((id) => id !== right.id),
    );
  }
  const projectionMarker =
    materialization && `projection-cut:${materialization.boundary}`;
  if (projectionMarker) {
    // At a collapsed seam, an empty paragraph and an erased-run start still
    // belong to their logical source side. Capture that side before joining;
    // numeric offsets cannot distinguish it once both sides coincide.
    for (const [id, cut] of Object.entries(state.boundaries)) {
      if (
        (cut.block === left.id && cut.offset === a.length) ||
        (cut.block === right.id && cut.offset === 0)
      ) {
        writable(state, "boundaries")[id] = {
          ...cut,
          listAffinity: {
            ...cut.listAffinity,
            [projectionMarker]: cut.block === left.id ? "left" : "right",
          },
        };
      }
    }
  }
  repartition(
    state,
    [left.id, right.id],
    [{ block: left.id, pieces: concatPieces(a.pieces, b.pieces) }],
    action,
    null,
    [],
    materialization,
  );
  writable(state, "nodes")[right.id] = { ...right, live: false };
  // Restore the exact structural cut even if neither side contains a character.
  const marker = materialization
    ? `projection-cut:${materialization.boundary}`
    : `${action}:boundary`;
  let at;
  if (materialization && state.boundaries[marker]) {
    writable(state, "boundaries")[marker] = {
      ...state.boundaries[marker],
      block: left.id,
      offset: a.length,
    };
    at = { codec: 3, boundary: marker };
  } else at = rememberBoundary(state, marker, left.id, a.length);
  return {
    kind: intent.kind === "unsplitList" ? "listSplit" : "split",
    at,
    tail: right.id,
    ...(intent.kind === "unsplitList"
      ? { children: intent.children, item: intent.item }
      : {}),
  };
}
function insert(state, intent, action) {
  if (intent.erasure) return restoreErasure(state, intent, action);
  const seen = locateAtoms(state);
  let origin = insertionOrigin(state, intent);
  const at = originPlacement(state, origin, resolveGap(state, intent.at), {
      atoms: (p) => readPieces(state.runs, p),
      locations: seen,
    }),
    n = requireText(state, at.block);
  if (origin)
    origin = { ...origin, ...listGapAffinities(state, at.block, at.offset) };
  let character = 0;
  const atoms = intent.pieces
    ? readPieces(state.runs, intent.pieces)
    : (intent.atoms ??
      (
        intent.runs || [{ text: intent.text, marks: intent.marks || [] }]
      ).flatMap((run) =>
        [...run.text].map((char) => ({
          id: `${action}:char:${character++}`,
          char,
          marks: copy(run.marks || []),
        })),
      ));
  for (const atom of atoms) {
    if (seen.has(atom.id)) throw new Conflict("Character is already live");
    if (intent.restore && state.deleted[atom.id] !== intent.restore)
      throw new Conflict("Deletion ownership changed");
  }
  const pieces = intent.pieces || internAtoms(writable(state, "runs"), atoms);
  writable(state, "replicas")[n.text] = spliceReplica(
    state.replicas[n.text],
    at.offset,
    0,
    pieces,
  );
  insertAtBoundaries(
    state,
    n.id,
    at.offset,
    atoms.length,
    intent.at,
    !!intent.restore,
  );
  for (const atom of atoms) erase(state, "deleted", atom.id);
  return {
    kind: "delete",
    ids: atoms.map((a) => a.id),
    ...(origin ? { origin } : {}),
  };
}
// A deleted run has one durable start marker and ordered cut affiliations.
// Restoration follows the cuts' current owners, rather than placing the entire
// run in whichever paragraph happens to contain a surviving neighbour.
function restoreErasure(state, intent, action) {
  const start = state.boundaries[intent.at.boundary],
    pieces = intent.pieces;
  if (!start) throw new Conflict("Missing deletion start");
  const size = pieces.reduce((n, p) => n + p.length, 0),
    key = intent.erasure;
  if (!state.erasures[key]) throw new Conflict("Missing deletion membership");
  const cuts = erasureCuts(state, key)
    .map(([id, at]) => ({ id, ...state.boundaries[id], at }))
    .sort((a, b) => a.at - b.at);
  let parts = [{ at: 0, block: start.block, offset: start.offset }];
  for (const cut of cuts)
    if (cut.at > 0 && cut.at < size && cut.block !== parts.at(-1).block)
      parts.push(cut);
  parts = restorationParts(state, intent, action, parts, {
    atoms: (p) => readPieces(state.runs, p),
    locations: locateAtoms(state),
    remember: (id, block, offset) => rememberBoundary(state, id, block, offset),
    conflict: (message) => new Conflict(message),
  });
  const ids = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i],
      end = parts[i + 1]?.at ?? size;
    const before = erasureCuts(state, key).filter(
      ([id, at]) =>
        state.boundaries[id].block === part.block &&
        state.boundaries[id].offset === part.offset &&
        at >= part.at &&
        at <= end,
    );
    const inverse = insert(
      state,
      {
        kind: "insert",
        at: {
          codec: 3,
          boundary:
            i === 0 && !part.originSegment ? intent.at.boundary : part.id,
        },
        pieces: slicePieces(pieces, part.at, end),
        restore: intent.restore,
      },
      action,
    );
    ids.push(...inverse.ids);
    // Only markers still at this collapsed gap need their erased offsets
    // expanded. A prior restoration may already have resolved another marker
    // to either side; stale membership must not pull it back into this span.
    const restoredOffset = restoredCutOffsets(state, pieces, part.block, {
      atoms: (p) => readPieces(state.runs, p),
      locations: locateAtoms(state),
    });
    for (const [id, offset] of before)
      writable(state, "boundaries")[id] = {
        ...state.boundaries[id],
        offset: restoredOffset(id, offset, part.offset + offset - part.at),
      };
  }
  clearErasure(state, key);
  return { kind: "delete", ids };
}
function remove(state, intent, action) {
  const locations = locateAtoms(state),
    groups = new Map(),
    restore = [];
  for (const id of intent.ids) {
    const found = locations.get(id);
    if (!found) continue;
    if (!groups.has(found.block)) groups.set(found.block, []);
    groups.get(found.block).push(found);
  }
  for (const [block, items] of groups) {
    items.sort((a, b) => a.offset - b.offset);
    // Separate runs retain remote contributions between the selected identities.
    const runs = [];
    for (const item of items) {
      const run = runs.at(-1);
      if (run && run.at(-1).offset + 1 === item.offset) run.push(item);
      else runs.push([item]);
    }
    const erasures = new Map();
    for (const run of runs) {
      const erasure = `${action}:erase:${restore.length}`,
        at = rememberBoundary(state, erasure, block, run[0].offset);
      erasures.set(run, erasure);

      restore.push({
        kind: "insert",
        at,
        erasure,
        pieces: slicePieces(
          state.replicas[state.nodes[block].text].pieces,
          run[0].offset,
          run.at(-1).offset + 1,
        ),
        restore: action,
      });
    }
    const n = requireText(state, block);
    let replica = state.replicas[n.text];
    for (const run of runs.toReversed()) {
      replica = spliceReplica(replica, run[0].offset, run.length);
      deleteAtBoundaries(
        state,
        block,
        run[0].offset,
        run.length,
        erasures.get(run),
      );
    }
    writable(state, "replicas")[n.text] = replica;
    // Deletion can collapse older retained positions onto a family seam too.
    // Their original partition is still known here, before repartitioning.
    // Preserve that side for every coincident marker, not just this deletion's
    // start; an old Redo marker must not divert restored source characters.
    // Previously certified affinities remain authoritative across later Undo.
    for (const [id, marker] of Object.entries(state.boundaries))
      if (marker.block === block) {
        const affinity = listGapAffinities(
          state,
          marker.block,
          marker.offset,
        ).listAffinity;
        if (affinity)
          writable(state, "boundaries")[id] = {
            ...marker,
            listAffinity: { ...affinity, ...marker.listAffinity },
          };
      }
    if (replica.length === 0 && !state.boundaries[`${n.text}:empty`])
      rememberBoundary(state, `${n.text}:empty`, block, 0);
    for (const item of items) writable(state, "deleted")[item.atom.id] = action;
  }
  return { kind: "batch", intents: restore };
}
function move(state, intent) {
  const owner = parent(state, intent.node);
  if (!owner) throw new Conflict("Move target is not live");
  const oldIndex = owner.children.indexOf(intent.node),
    next = owner.children[oldIndex + 1] ?? null;
  const children = owner.children.filter((id) => id !== intent.node);
  const destination =
    intent.before === null ? children.length : children.indexOf(intent.before);
  if (destination < 0) throw new Conflict("Move neighbour changed");
  children.splice(destination, 0, intent.node);
  updateChildren(state, owner, children);
  return { kind: "move", node: intent.node, before: next };
}
function format(state, intent, action) {
  state.formats = { ...state.formats };
  checkFormat(intent.property, intent.value);
  const locations = locateAtoms(state),
    ids = [...new Set(intent.ids)];
  for (const id of ids) {
    const found = locations.get(id);
    if (
      !found ||
      (state.nodes[found.block].type === "code" &&
        !["strong", "em", "underline", "strike", "highlight", "color"].includes(
          intent.property,
        ) &&
        !(intent.property === "link" && intent.value === null))
    )
      continue;
    state.formats[id] = contribute(
      state.formats[id],
      found.atom.marks,
      action,
      intent.property,
      intent.value,
    );
  }
  return { kind: "formatActive", ids, contribution: action, active: false };
}
function formatActive(state, intent) {
  state.formats = { ...state.formats };
  for (const id of intent.ids) {
    const cell = activate(
      state.formats[id],
      intent.contribution,
      intent.active,
    );
    if (cell) state.formats[id] = cell;
  }
  return { ...intent, active: !intent.active };
}
function execute(state, intent, action, materialization = null) {
  const creationHost = {
    action,
    execute: (i, id) => execute(state, i, id, materialization),
    write: (field) => writable(state, field),
    fail: (m) => new Conflict(m),
  };
  prepareCreationTarget(state, intent, creationHost);
  const boundaryPath = placementBoundaryPath(state, intent, (at) =>
    resolveGap(state, at),
  );
  if (boundaryPath) {
    suspendCreationPlacements(state, creationHost);
    const inverse = execute(state, intent, action, materialization);
    resumeCreationPlacements(state, boundaryPath, creationHost);
    return inverse;
  }
  if(intent.kind === 'imagePlace') return executeImagePlacement(state,intent,action,{execute:(i,id)=>execute(state,i,id,materialization),write:field=>writable(state,field),resolve:gap=>resolveGap(state,gap),gap:(id,offset)=>gapAt(state,id,offset),fail:m=>new Conflict(m)});
  if(['imageInsert','imageComplete','imageDelete','imagePresence','mediaNoop'].includes(intent.kind))return executeMedia(state,intent,action,{write:field=>writable(state,field),resolve:gap=>resolveGap(state,gap),fail:m=>new Conflict(m)});
  if (["tableCreate","tableCreationActive"].includes(intent.kind))
    return executeTableCreate(state,intent,action,{write:field=>writable(state,field),remember:(id,block,offset)=>rememberBoundary(state,id,block,offset),resolve:gap=>resolveGap(state,gap),fail:m=>new Conflict(m)});
  if (intent.kind === "creationItemMove")
    return execute(
      state,
      creationItemSteps(state, intent, action, creationHost.fail),
      action,
      materialization,
    );
  if (intent.kind === "creationPlacementActive")
    return executeCreationPlacementActive(state, intent, action, creationHost);
  if (intent.kind === "creationActive")
    return executeCreationActive(state, intent, action, creationHost);
  if (["listRunStart", "listRunStartActive"].includes(intent.kind))
    return executeRunStart(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (["listNumbering", "listNumberingActive"].includes(intent.kind))
    return executeListNumbering(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (intent.kind === "richInsert")
    return executeRichInsert(state, intent, action, {
      execute: (i, id) => execute(state, i, id, materialization),
      resolve: (at) => resolveGap(state, at),
      gap: (id, offset) => gapAt(state, id, offset),
      write: (field) => writable(state, field),
      remember: (id, block, offset) =>
        rememberBoundary(state, id, block, offset),
      fail: (m) => new Conflict(m),
    });
  if (intent.kind === "richForestActive")
    return executeRichForestActive(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (intent.kind === "proseReplace")
    return executeProseReplace(state, intent, action, {
      execute: (i, id) => execute(state, i, id, materialization),
      resolve: (at) => resolveGap(state, at),
      gap: (id, offset) => gapAt(state, id, offset),
    });
  if (intent.kind === "expandPasteCells")
    return executeExpandingPaste(state, intent, action, (i, id) =>
      execute(state, i, id, materialization),
    );
  if (["tableDelete", "tableDeletionActive"].includes(intent.kind))
    return executeTableDelete(state, intent, action, {
      write: (field) => writable(state, field),
      remember: (id, block, offset) =>
        rememberBoundary(state, id, block, offset),
      fail: (m) => new Conflict(m),
    });
  if (["tableFormat", "tableFormatActive"].includes(intent.kind))
    return executeTableFormat(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (
    ["tableDistributeColumns", "restoreDistributedWidths"].includes(intent.kind)
  )
    return executeDistribution(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (["tableMove", "restoreTableOrder"].includes(intent.kind))
    return executeTableMove(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (["tableResizeRow", "restoreRowHeight"].includes(intent.kind))
    return executeRowResize(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (["tableResizeColumn", "restoreColumnWidth"].includes(intent.kind))
    return executeColumnResize(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  assertClearTargetsAvailable(state, intent, (m) => new Conflict(m));
  if (
    ["clearCells", "pasteCells", "restoreClearedCells"].includes(intent.kind)
  ) {
    try {
      return executeCellClear(state, intent, action, {
        write: (field) => writable(state, field),
        remember: (id, block, offset) =>
          rememberBoundary(state, id, block, offset),
        fail: (m) => new Conflict(m),
      });
    } catch (error) {
      throw new Conflict(error.message);
    }
  }
  if (
    [
      "insertBoundaryParagraph",
      "boundaryParagraphActive",
      "restoreClearedCells",
    ].includes(intent.kind)
  )
    return executeBoundaryParagraph(state, intent, action, {
      write: (field) => writable(state, field),
      remember: (id, block, offset) =>
        rememberBoundary(state, id, block, offset),
      insert: (i, id) => insert(state, i, id),
      fail: (m) => new Conflict(m),
    });
  if (
    [
      "tableInsertColumn",
      "tableColumnActive",
      "tableInsertRow",
      "tableRowActive",
    ].includes(intent.kind)
  ) {
    try {
      return (
        ["tableInsertColumn", "tableColumnActive"].includes(intent.kind)
          ? executeTableColumn
          : executeTableRow
      )(state, intent, action, {
        write: (field) => writable(state, field),
        remember: (id, block, offset) =>
          rememberBoundary(state, id, block, offset),
        fail: (m) => new Conflict(m),
      });
    } catch (error) {
      throw new Conflict(error.message);
    }
  }
  if (["listJoin", "proseJoin", "listJoinActive"].includes(intent.kind))
    return executeJoinContribution(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (["listMarker", "listMarkerActive"].includes(intent.kind))
    return executeMarker(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
    });
  if (
    [
      "proseEnter",
      "listEnter",
      "listBoundaryActive",
      "listHold",
      "listHoldActive",
    ].includes(intent.kind)
  ) {
    let inherited;
    if (intent.kind === "listEnter") {
      const point = resolveGap(state, intent.at);
      inherited =
        intent.marker ??
        enterMarker(state, parent(state, point.block).id, point.offset);
      validateMarkerType(inherited);
    }
    const result = (
      ["listHold", "listHoldActive"].includes(intent.kind)
        ? executeListHold
        : executeListBoundary
    )(state, intent, action, {
      parent: (id) => parent(state, id),
      resolve: (at) => resolveGap(state, at),
      write: (field) => writable(state, field),
      remember: (id, block, offset, gap) => {
        const point = rememberBoundary(state, id, block, offset);
        if (gap)
          for (const { key, at } of erasedBoundaryOrigins(state, gap, {
            atoms: (p) => readPieces(state.runs, p),
            cuts: (key) => erasureCuts(state, key),
          }))
            addErasureBoundary(state, key, id, at);
        return point;
      },
      repartition: (sources, targets, id, cuts) =>
        repartition(state, sources, targets, id, null, cuts),
      fail: (m) => new Conflict(m),
    });
    if (inherited) {
      const id = `${action}:list-item`,
        n = state.nodes[id];
      if (n) writable(state, "nodes")[id] = { ...n, markerBase: inherited };
      const tail = `${action}:list-tail`,
        paragraph = state.nodes[tail];
      if (paragraph)
        writable(state, "nodes")[tail] = {
          ...paragraph,
          listMarkerBase: inherited,
        };
    }
    return result;
  }
  if (treeKinds.has(intent.kind))
    return executeTree(state, intent, action, {
      write: () => writable(state, "nodes"),
      fail: (message) => new Conflict(message),
    });
  if (intent.kind === "format") return format(state, intent, action);
  if (intent.kind === "formatActive") return formatActive(state, intent);
  if (intent.kind === "removeSplitBoundary")
    return removeSplitBoundary(state, intent, action);
  if (intent.kind === "move") return move(state, intent);
  if (intent.kind === "insert") return insert(state, intent, action);
  if (["delete", "textClaimActive"].includes(intent.kind))
    return executeTextClaim(state, intent, action, {
      write: (field) => writable(state, field),
      fail: (m) => new Conflict(m),
      execute: (i, id) => execute(state, i, id),
      remove: (i, id) => remove(state, i, id),
      identities: (p) => identities(p),
    });
  if (["split", "listSplit"].includes(intent.kind))
    return split(state, intent, action, materialization);
  if (["join", "unsplitList"].includes(intent.kind))
    return join(state, intent, action, materialization);
  if (intent.kind === "batch")
    return {
      kind: "batch",
      intents: intent.intents
        .map((part, i) =>
          execute(state, part, `${action}:part:${i}`, materialization),
        )
        .reverse(),
    };
  throw new Error("Unsupported intent");
}
export function apply(state, op, validateFinalShape = null) {
  if (state.storageCodec !== 43)
    throw new Conflict("Incompatible storage codec");
  if (op.epoch !== state.epoch) throw new Conflict("Document epoch changed");
  function internal(i) {
    return (
      !!i.revive ||
      !!i.origin ||
      !!i.erasure ||
      !!i.restore ||
      [
        "textClaimActive",
        "creationPlacementActive",
        "creationActive",
        "listHoldActive",
        "listRunStart",
        "listRunStartActive",
        "listMarker",
        "listMarkerActive",
        "listNumberingActive",
        "richForestActive",
        "tableFormatActive",
        "restoreDistributedWidths",
        "restoreRowHeight",
        "restoreTableOrder",
        "restoreColumnWidth",
        "tableDeletionActive",
        "tableCreationActive",
        "imagePresence",
        "mediaNoop",
        "formatActive",
        "removeSplitBoundary",
        "treeRestore",
        "tableColumnActive",
        "listBoundaryActive",
        "listJoinActive",
        "tableRowActive",
        "boundaryParagraphActive",
        "restoreClearedCells",
      ].includes(i.kind) ||
      (i.kind === "batch" && i.intents.some(internal))
    );
  }
  if (internal(op.intent))
    throw new Conflict(
      "Restoration, formatting activation or structural lifecycle is internal to owned Undo",
    );
  if (["clearCells", "pasteCells"].includes(op.intent.kind))
    try {
      validateClearRequest(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "expandPasteCells")
    try {
      validateExpandingPaste(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableDelete")
    try {
      validateTableDelete(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableMove")
    try {
      validateTableMove(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableFormat")
    try {
      validateTableFormat(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableDistributeColumns")
    try {
      validateDistribution(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableResizeRow")
    try {
      validateRowResize(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "tableResizeColumn")
    try {
      validateColumnResize(state, op.intent);
    } catch (error) {
      throw new Conflict(error.message);
    }
  if (op.intent.kind === "richInsert")
    validateRichInsert(state, op.intent, {
      resolve: (at) => resolveGap(state, at),
      fail: (m) => new Conflict(m),
    });
  if (op.intent.kind === "proseReplace")
    validateProseReplace(state, op.intent, {
      resolve: (at) => resolveGap(state, at),
      find: (id) => findCharacter(state, id),
      fail: (m) => new Conflict(m),
    });
  const next = stage(state);
  let intent = op.intent;
  if (intent.kind === "undo") {
    const ids = intent.targets || [intent.target];
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new Conflict("Invalid Undo group");
    const inverses = ids.map((id) => {
      const target = state.effects[id];
      if (target?.system) throw new Conflict("Upload completion is not a user Undo action");
      if (!target || target.actor !== op.actor)
        throw new Conflict("Undo belongs to another actor");
      if (Object.values(state.effects).some((e) => e.undoes?.includes(id)))
        throw new Conflict("Action already undone");
      return target.inverse;
    });
    intent =
      inverses.length === 1
        ? inverses[0]
        : { kind: "batch", intents: inverses };
  }
  const projectionHost = {
    action: op.id,
    resolve: (at) => resolveGap(next, at),
    execute: (i, id, projection) => execute(next, i, id, projection),
    write: (field) => writable(next, field),
    fail: (m) => new Conflict(m),
  };
  const rebuildProjection =
    creationRequiresJoinExpansion(next) ||
    !canReuseJoinProjection(next, intent, projectionHost);
  if (rebuildProjection) expandJoins(next, op.id, projectionHost);
  const held =
    op.intent.kind !== "undo" &&
    beginCreationPlacement(next, intent, op.id, projectionHost);
  let inverse = execute(next, intent, op.id);
  if (held)
    inverse = finishCreationPlacement(
      next,
      op.id,
      held,
      intent,
      inverse,
      projectionHost,
    );
  projectCreations(next, projectionHost);
  if (rebuildProjection) projectJoins(next, op.id, projectionHost);
  fenceMedia(state,next,op.id,field=>writable(next,field));
  writable(next, "effects")[op.id] = {
    actor: op.actor,
    ...(op.intent.kind==="imageComplete"?{system:true}:{}),
    inverse,
    ...(op.intent.kind === "undo"
      ? { undoes: op.intent.targets || [op.intent.target] }
      : {}),
  };
  next.revision = state.revision + 1;
  // Only host-sealed predecessors permit sharing. Every new ownership object
  // here is internal to this synchronous transition; sealing it creates no
  // mutable publication window. Mutable/decode inputs keep their old fallback.
  if (isImmutable(state)) {
    immutable(next.nodes);
    immutable(next.pendingMedia);
    immutable(next.replicas);
    immutable(next.runs);
  }
  if (validateFinalShape) validateFinalShape(next);
  validateChanged(next, validate);
  return finish(next);
}
const checkedRuns = new WeakSet();
export function validate(state, incremental = false) {
  validateTextClaims(state);
  validateCreations(state);
  validateCreationPlacements(state);
  validateDeletedStructures(state);
  validateMarkers(state);
  validateListNumberings(state);
  validateTableFormats(state);
  validateRowHeightOwners(state);
  validateColumnWidthOwners(state);
  validateTableOrderOwners(state);
  validateTableRows(state);
  validateTableColumns(state);
  validateBoundaryParagraphs(state);
  validateListFamilies(state);
  validateJoins(state);
  if (state.storageCodec !== 43)
    throw new Conflict("Incompatible storage codec");
  const visited = new Set(),
    textOwners = new Set();
  function walk(id, ancestors = []) {
    const n = state.nodes[id];
    if (!n?.live || visited.has(id))
      throw new Error("Missing, repeated or cyclic node");
    visited.add(id);
    if (n.type === "table" && ancestors.includes("cell"))
      throw new Error("Nested table");
    if (
      n.type === "list_item" &&
      state.nodes[n.children?.[0]]?.type !== "paragraph"
    )
      throw new Error("List item has no first paragraph");
    if (n.text) {
      const r = state.replicas[n.text];
      if (!r || r.retired || r.owner !== n.id || textOwners.has(r.id))
        throw new Error("Invalid live text owner");
      textOwners.add(r.id);
    }
    for (const child of n.children || []) walk(child, [...ancestors, n.type]);
  }
  walk(state.root);
  validateBoundaries(state);
  for (const n of Object.values(state.nodes))
    if (n.live && !visited.has(n.id)) throw new Error("Orphan node");
  for (const r of Object.values(state.replicas))
    if (!r.retired && !textOwners.has(r.id)) throw new Error("Orphan replica");
  locateAtoms(state); // Detect duplicate live ownership without enumerating characters.
  for (const run of Object.values(state.runs)) {
    if (incremental && isImmutable(run) && checkedRuns.has(run)) continue;
    if (
      !Array.isArray(run.chars) ||
      !Array.isArray(run.formats) ||
      run.chars.some(
        (char) => typeof char !== "string" || [...char].length !== 1,
      )
    )
      throw Error("Invalid character");
    let end = 0;
    for (const f of run.formats) {
      if (
        f.from !== end ||
        !Number.isSafeInteger(f.length) ||
        f.length < 1 ||
        !Array.isArray(f.marks)
      )
        throw Error("Invalid mark range");
      end += f.length;
    }
    if (end !== run.chars.length) throw Error("Missing mark range");
    if (isImmutable(run)) checkedRuns.add(run);
  }
  for (const replica of Object.values(state.replicas)) {
    let length = 0;
    for (const p of replica.pieces) {
      const run = state.runs[p.run];
      if (
        !run ||
        !Number.isSafeInteger(p.from) ||
        !Number.isSafeInteger(p.length) ||
        p.from < 0 ||
        p.length < 1 ||
        p.from + p.length > run.chars.length
      )
        throw Error("Invalid backing slice");
      length += p.length;
    }
    if (length !== replica.length) throw Error("Replica length mismatch");
  }
}
export function seed(nodes, contents, root = "doc") {
  const state = {
    storageCodec: 43,
    pendingMedia: {},
    textClaims: {},
    textMasks: {},
    creations: {},
    creationPlacements: {},
    listJoins: {},
    joinProjection: [],
    listFamilies: {},
    runs: {},
    formats: {},
    epoch: 1,
    revision: 0,
    root,
    nodes: copy(nodes),
    replicas: {},
    boundaries: {},
    boundaryOrder: [],
    cutLinks: [],
    erasures: {},
    effects: {},
    lineage: [],
    deleted: {},
  };
  for (const [block, runs] of Object.entries(contents)) {
    const atoms = [];
    for (const run of runs)
      for (const char of run.text)
        atoms.push({
          id: `seed:${block}:${atoms.length}`,
          char,
          marks: copy(run.marks || []),
        });
    const id = `seed:${block}`;
    state.nodes[block].text = id;
    writable(state, "replicas")[id] = createReplica(
      id,
      block,
      internAtoms(writable(state, "runs"), atoms),
      "seed",
    );
    if (!atoms.length) rememberBoundary(state, `${id}:empty`, block, 0);
  }
  validate(state);
  return state;
}

export function findCharacter(state, id) {
  return locateAtoms(state).get(id);
}
