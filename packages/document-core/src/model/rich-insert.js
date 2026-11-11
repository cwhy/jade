// SPDX-License-Identifier: MPL-2.0
import {
  attachedSourcePaste,
  executeAttachedSourcePaste,
} from "./attached-source-paste.js";
import {
  itemMarker,
  listMarkers,
  structuralMarkerShape,
} from "./list-marker.js";
import { structuralNumberingShape } from "./list-numbering.js";
import { validateRichSlice } from "../rich-slice.js";
import { validateGridAssets } from "../grid-fragment.js";
import { createReplica } from "../text/pieces.js";
import { deriveFlowRegions } from "./flow-placement.js";
import { treeParent } from "./tree.js";

// The public request carries content and an existing gap, never node IDs,
// replica IDs, retirement records or an executable tree mutation sequence.
export function validateRichInsert(state, intent, { resolve, fail }) {
  const bad = (m) => {
    throw fail(m);
  };
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "parent", "at", "slice"].includes(k),
    ) ||
    typeof intent.parent !== "string"
  )
    bad("Invalid rich insertion");
  const point = resolve(intent.at),
    requested = state.nodes[intent.parent],
    actual = treeParent(state, point.block);
  const family = Object.values(state.listFamilies).find((f) =>
    f.layout.blocks.includes(point.block),
  );
  const slice = validateRichSlice(intent.slice);
  const flatAttachment = flatAttachmentPaste(state, slice, actual, family);
  if (family?.generatedChildList && !flatAttachment)
    bad(
      "Rich paste in an attachment split needs separate flow-placement qualification; destination unchanged",
    );
  const requestedList = requested && treeParent(state, requested.id),
    actualList = actual && treeParent(state, actual.id);
  const sameList =
    requested?.type === "list_item" &&
    actual?.type === "list_item" &&
    (requestedList?.id === actualList?.id ||
      (requested.children?.[1] === actualList?.id &&
        family?.childList === actualList?.id));
  const knownWrapper =
    family &&
    (family.homeItem === requested?.id ||
      Object.values(family.cuts).some((c) => c.wrapper === requested?.id) ||
      family.homePins?.some(
        (p) =>
          p.item === requested?.id ||
          Object.values(p.wrappers || {}).includes(requested?.id),
      ));
  // A saved caret may name a wrapper retired by another author's Undo.
  // Follow its retained family only within that family's live list containers;
  // unrelated/deleted containers are never an alternate admission destination.
  const retiredPartition =
    flatAttachment &&
    knownWrapper &&
    requested?.live === false &&
    (family.homeItem === actual?.id ||
      Object.values(family.cuts).some((c) => c.wrapper === actual?.id)) &&
    [family.list, family.childList].includes(actualList?.id);
  const parent =
    requested?.id === actual?.id
      ? requested
      : (sameList && knownWrapper) || retiredPartition
        ? actual
        : null;
  if (
    !parent?.live ||
    !["doc", "cell", "list_item"].includes(parent.type) ||
    state.nodes[point.block]?.type !== "paragraph" ||
    treeParent(state, point.block)?.id !== parent.id
  )
    bad("Rich insertion requires a plain paragraph in this container");
  if (attachedSourcePaste(state, slice, parent)) {
    validateGridAssets(state, { rows: [[slice.blocks]] });
    return slice;
  }
  if (parent.type === "list_item") {
    const list = treeParent(state, parent.id),
      last = slice.blocks[0]?.children?.at(-1);
    const child = state.nodes[parent.children[1]];
    // Single-text native copies default to one; flat multi-item copies preserve
    // the source start. Final attachments remain outside this admission subset.
    const observedReverse =
      list?.type === "bullet_list" &&
      parent.children.length === 2 &&
      child?.type === "ordered_list" &&
      slice.blocks.length === 1 &&
      slice.blocks[0].type === "ordered_list" &&
      ((slice.blocks[0].children.length === 1 &&
        (slice.blocks[0].order ?? 1) === 1) ||
        (slice.blocks[0].children.length > 1 &&
          flatItems(slice, "ordered_list"))) &&
      (point.offset !== 0 ||
        listMarkers(state, list.id).every(
          (marker) => marker.type === "bullet_list",
        ));
    const nested =
      parent.children.length === 2 &&
      (child?.type === list?.type || observedReverse);
    if (
      nested &&
      point.offset === 0 &&
      slice.blocks[0]?.children?.[0]?.children.length !== 1
    )
      bad(
        "Start paste with a copied child attachment needs a separate placement contract",
      );
    const semanticType = itemMarker(state, parent.id);
    const flatMixed =
      flatBulletItems(slice) && slice.blocks[0].children.length > 1;
    if (
      slice.blocks[0]?.type !== list?.type &&
      slice.blocks[0]?.children?.length !== 1 &&
      !flatMixed &&
      !observedReverse
    )
      bad("Multiple mixed-type source items need separate qualification");
    const observedMixed =
      (slice.blocks[0]?.children?.length === 1 || flatMixed) &&
      slice.blocks[0]?.type === "bullet_list" &&
      list?.type === "ordered_list" &&
      (nested || (family?.childList === list.id && knownWrapper));
    if (
      (parent.children.length !== 1 && !nested && !flatAttachment) ||
      slice.blocks.length !== 1 ||
      (slice.blocks[0].type !== semanticType &&
        !observedMixed &&
        !observedReverse) ||
      !["ordered_list", "bullet_list"].includes(list?.type) ||
      last?.children.length !== 1 ||
      last.children[0].type !== "paragraph"
    )
      bad(
        "List-item paste requires a leaf destination or matching nested list and a matching source list with a plain final item; destination unchanged",
      );
  }
  // A final list leaf adopts the existing suffix identity. A final code or
  // image inside a list needs a separately qualified suffix-placement contract.
  if (
    ["ordered_list", "bullet_list"].includes(slice.blocks.at(-1).type) &&
    !listTail(slice.blocks.at(-1))
  )
    bad(
      "List-ending attachment needs a separate suffix contract; destination unchanged",
    );
  if (slice.blocks.every((b) => b.type === "paragraph"))
    bad("Paragraph-only content uses prose replacement");
  validateGridAssets(state, { rows: [[slice.blocks]] });
  return slice;
}
// Attached destinations use the already retained Enter partitions. This
// admission deliberately excludes nested or attachment-bearing source items.
function flatAttachmentPaste(state, slice, parent, family) {
  const list = parent && treeParent(state, parent.id);
  return (
    parent?.type === "list_item" &&
    ["ordered_list", "bullet_list"].includes(list?.type) &&
    slice?.blocks?.[0]?.children?.length > 1 &&
    flatItems(slice, list.type) &&
    (slice.blocks[0].order ?? 1) === 1 &&
    itemMarker(state, parent.id) === list.type &&
    (family?.generatedChildList ||
      (parent.children.length > 1 &&
        parent.children
          .slice(1)
          .every((id) => ["code", "image"].includes(state.nodes[id]?.type))))
  );
}
const flatBulletItems = (slice) => flatItems(slice, "bullet_list");
function flatItems(slice, type) {
  return (
    slice.blocks.length === 1 &&
    slice.blocks[0].type === type &&
    slice.blocks[0].children.every(
      (i) => i.children.length === 1 && i.children[0].type === "paragraph",
    )
  );
}
function listTail(block) {
  if (!["ordered_list", "bullet_list"].includes(block?.type)) return null;
  const item = block.children.at(-1);
  if (item.children.length === 1 && item.children[0].type === "paragraph")
    return item.children[0];
  return listTail(item.children.at(-1));
}
const shape = (node) => {
  const {
    live,
    text,
    placement,
    retiredBy,
    richRetiredBy,
    richLifecycle,
    ...rest
  } = structuralMarkerShape(structuralNumberingShape(node));
  return { ...rest, placement: placement ?? null };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Creation and owned removal are paired. Text removal uses the usual owned
// character inverses. Only empty, unchanged created structure may then retire.
// A peer contribution makes the whole Undo fail atomically, never disappear.
export function executeRichForestActive(
  state,
  intent,
  action,
  { write, fail },
) {
  const parent = state.nodes[intent.parent];
  if (
    !parent?.live ||
    !["doc", "cell", "ordered_list", "bullet_list"].includes(parent.type)
  )
    throw fail("Pasted container is unavailable");
  for (const entry of intent.manifest) {
    const n = state.nodes[entry.id],
      r = n?.text && state.replicas[n.text];
    if (
      !n ||
      n.live === intent.active ||
      n.richLifecycle !== intent.expected ||
      !same(shape(n), entry.shape)
    )
      throw fail("Pasted structure changed; review Undo");
    if (n.text && (!r || r.length || r.retired !== intent.active))
      throw fail(
        "Pasted content has other contributions; Undo cannot remove it",
      );
  }
  let children = [...parent.children];
  if (!intent.active) {
    const start = children.indexOf(intent.roots[0]);
    if (
      start < 0 ||
      !same(children.slice(start, start + intent.roots.length), intent.roots)
    )
      throw fail("Pasted blocks moved; review Undo");
    if (intent.borrowed && !state.nodes[intent.borrowed]?.live)
      throw fail("Adopted suffix is unavailable");
    children.splice(
      start,
      intent.roots.length,
      ...(intent.borrowed ? [intent.borrowed] : []),
    );
  } else {
    const at =
      intent.before === null
        ? children.length
        : children.indexOf(intent.before);
    if (
      at < 0 ||
      intent.roots.some((id) => id !== intent.borrowed && children.includes(id))
    )
      throw fail("Paste restoration boundary changed");
    children.splice(at, intent.borrowed ? 1 : 0, ...intent.roots);
  }
  const ids = new Set(intent.manifest.map((n) => n.id));
  for (const id of ids) {
    const n = {
      ...state.nodes[id],
      live: intent.active,
      richLifecycle: action,
    };
    if (intent.active) {
      delete n.retiredBy;
      delete n.richRetiredBy;
    } else {
      n.retiredBy = action;
      n.richRetiredBy = action;
    }
    write("nodes")[id] = n;
    if (n.text)
      write("replicas")[n.text] = {
        ...state.replicas[n.text],
        retired: !intent.active,
      };
  }
  for (const [id, cut] of Object.entries(state.boundaries))
    if (ids.has(cut.block)) {
      const next = { ...cut };
      if (intent.active) delete next.retiredBy;
      else next.retiredBy = action;
      write("boundaries")[id] = next;
    }
  write("nodes")[parent.id] = { ...parent, children };
  return { ...intent, active: !intent.active, expected: action };
}

export function executeRichInsert(state, intent, action, host) {
  const slice = validateRichSlice(intent.slice),
    inverse = [];
  const step = (i, id) => inverse.unshift(host.execute(i, id));
  const at = host.resolve(intent.at),
    blocks = [...slice.blocks];
  const destination = treeParent(state, at.block),
    itemDestination = destination?.type === "list_item",
    childList = itemDestination
      ? state.nodes[destination.children[1]] ||
        state.nodes[state.nodes[intent.parent]?.children?.[1]]
      : null;
  if (attachedSourcePaste(state, slice, destination))
    return executeAttachedSourcePaste(state, slice, at, action, host);
  const attachmentFlat = flatAttachmentPaste(
    state,
    slice,
    destination,
    Object.values(state.listFamilies).find((f) =>
      f.layout.blocks.includes(at.block),
    ),
  );
  const sourceType = slice.blocks[0].type,
    mergeStart = !!childList && at.offset === 0,
    firstItem = mergeStart ? slice.blocks[0].children[0] : null;
  // Flat list items are text partitions, just like Enter. Keeping them in one
  // lineage lets owned Undo remove only the paste's cuts, including when a peer
  // has introduced more cuts or delivers offline input after the paste's Undo.
  if (
    itemDestination &&
    blocks[0].children?.length > 1 &&
    (attachmentFlat ||
      (treeParent(state, destination.id)?.type === "ordered_list" &&
        flatBulletItems(slice)) ||
      (flatItems(slice, "ordered_list") &&
        (treeParent(state, destination.id)?.type === "bullet_list" ||
          treeParent(state, intent.parent)?.type === "bullet_list")))
  ) {
    let block = at.block;
    const cut = (offset, index) => {
      const id = `${action}:flat-cut:${index}`;
      step(
        { kind: "listEnter", at: host.gap(block, offset), marker: sourceType },
        id,
      );
      return `${id}:list-tail`;
    };
    if (at.offset > 0) block = cut(at.offset, "prefix");
    const firstBlock = block;
    for (const [i, item] of blocks[0].children.entries()) {
      const next = i < blocks[0].children.length - 1 ? cut(0, i) : null;
      const runs = item.children[0].content.filter((r) => r.text.length);
      if (runs.length)
        step(
          { kind: "insert", at: host.gap(block, 0), runs },
          `${action}:flat-content:${i}`,
        );
      if (next) block = next;
    }
    if (mergeStart && !attachmentFlat)
      step(
        { kind: "listMarker", block: firstBlock, type: sourceType },
        `${action}:marker`,
      );
    if (sourceType === "ordered_list" && !attachmentFlat)
      step(
        {
          kind: "listRunStart",
          block: firstBlock,
          start: blocks[0].order ?? 1,
        },
        `${action}:run-start`,
      );
    return { kind: "batch", intents: inverse };
  }
  if (mergeStart)
    step(
      { kind: "listMarker", item: destination.id, type: sourceType },
      `${action}:marker`,
    );
  if (mergeStart && slice.blocks[0].children.length === 1) {
    const runs = firstItem.children[0].content.filter((r) => r.text.length);
    if (runs.length)
      step(
        { kind: "insert", at: host.gap(at.block, 0), runs },
        `${action}:prefix`,
      );
    return { kind: "batch", intents: inverse };
  }
  step(
    {
      kind: itemDestination ? "listEnter" : "proseEnter",
      at: host.gap(at.block, at.offset),
      ...(itemDestination ? { marker: sourceType } : {}),
    },
    `${action}:cut`,
  );
  const suffix = `${action}:cut:${itemDestination ? "list-tail" : "paragraph"}`;
  const suffixItem = itemDestination ? treeParent(state, suffix) : null;
  const finalItem = itemDestination ? blocks[0].children.at(-1) : null;
  if (itemDestination)
    blocks.splice(
      0,
      blocks.length,
      ...blocks[0].children.slice(mergeStart ? 1 : 0),
    );

  const first = blocks[0].type === "paragraph" ? blocks.shift() : null;
  const last = blocks.at(-1)?.type === "paragraph" ? blocks.pop() : null,
    adopted = itemDestination ? finalItem.children[0] : listTail(blocks.at(-1));
  function insert(block, offset, runs, id) {
    runs = runs.filter((r) => r.text.length);
    if (runs.length)
      step({ kind: "insert", at: host.gap(block, offset), runs }, id);
  }
  if (firstItem)
    insert(at.block, 0, firstItem.children[0].content, `${action}:first-item`);
  if (first) insert(at.block, at.offset, first.content, `${action}:prefix`);
  let serial = 0;
  const created = [],
    texts = [];
  function create(b) {
    if (b === finalItem) {
      texts.push({ id: suffix, content: adopted.content });
      return suffixItem.id;
    }
    if (b === adopted) {
      texts.push({ id: suffix, content: b.content });
      return suffix;
    }
    const id = `${action}:rich:${serial++}`,
      n = { id, type: b.type, live: true, richLifecycle: action };
    if (state.nodes[id]) throw host.fail("Pasted identity reused");
    if (itemDestination && b.type === "list_item" && blocks.includes(b))
      n.markerBase = sourceType;
    for (const key of ["order", "language", "asset", "alt", "width", "height"])
      if (b[key] !== undefined) n[key] = b[key];
    if (b.content) {
      n.text = `${id}:text`;
      if (state.replicas[n.text] || state.boundaries[`${n.text}:empty`])
        throw host.fail("Pasted replica identity reused");
      host.write("replicas")[n.text] = createReplica(n.text, id, [], action);
      host.remember(`${n.text}:empty`, id, 0);
      texts.push({ id, content: b.content });
    } else if (b.children) n.children = b.children.map(create);
    host.write("nodes")[id] = n;
    created.push({ id, shape: shape(n) });
    return id;
  }
  const roots = blocks.map(create),
    parent = itemDestination
      ? treeParent(state, suffixItem.id)
      : state.nodes[intent.parent],
    children = [...parent.children],
    position = children.indexOf(itemDestination ? suffixItem.id : suffix);
  if (!roots.length || position < 0)
    throw host.fail("Rich insertion lost its boundary");
  children.splice(position, adopted ? 1 : 0, ...roots);
  host.write("nodes")[parent.id] = { ...parent, children };
  inverse.unshift({
    kind: "richForestActive",
    parent: parent.id,
    roots,
    before: itemDestination ? suffixItem.id : suffix,
    ...(adopted ? { borrowed: itemDestination ? suffixItem.id : suffix } : {}),
    manifest: created,
    active: false,
    expected: action,
  });
  if (
    childList?.id === parent.id &&
    parent.type === "ordered_list" &&
    sourceType === "ordered_list"
  )
    step(
      {
        kind: "listNumbering",
        list: parent.id,
        start: slice.blocks[0].order ?? 1,
      },
      `${action}:numbering`,
    );
  if (itemDestination) {
    const original = Object.values(state.listFamilies).find((f) =>
      f.layout.blocks.includes(suffix),
    );
    const f = structuredClone(original);
    if (f.kind !== "flow") {
      f.homePins = [
        {
          item: f.homeItem,
          before: f.order.slice(0, f.order.indexOf("home")),
          after: f.order.slice(f.order.indexOf("home") + 1),
          wrappers: Object.fromEntries(
            Object.values(f.cuts).map((c) => [c.id, c.wrapper]),
          ),
        },
      ];
      f.order = ["home", ...f.order.filter((id) => id !== "home")];
      f.layout = { blocks: f.layout.blocks, home: 0 };
      let scope = parent;
      while (!["doc", "cell"].includes(scope.type))
        scope = treeParent(state, scope.id);
      f.parent = scope.id;
    }
    deriveFlowRegions(state, f, {
      parent: (id) => treeParent(state, id),
      fail: host.fail,
    });
    host.write("listFamilies")[f.id] = f;
  }
  for (const { id, content } of texts) insert(id, 0, content, `${id}:content`);
  if (last) insert(suffix, 0, last.content, `${action}:suffix`);
  return { kind: "batch", intents: inverse };
}
