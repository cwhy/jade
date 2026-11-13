// SPDX-License-Identifier: MPL-2.0
// Content lifecycle only. The host authorizes uploads and proves asset durability.
import { treeParent } from "./tree.js";
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((k) => keys.includes(k));
export function validateMedia(state, intent, { resolve, fail }) {
  if (intent.kind === "imageInsert") {
    if (
      !exact(intent, ["kind", "at", "slot", "width", "height"]) ||
      typeof intent.slot !== "string" ||
      !/^[-\w]{16,80}$/.test(intent.slot)
    )
      throw fail("Invalid image slot");
    for (const k of ["width", "height"])
      if (!Number.isInteger(intent[k]) || intent[k] < 1 || intent[k] > 10000)
        throw fail("Invalid image dimensions");
    const p = resolve(intent.at),
      n = state.nodes[p.block],
      parent = treeParent(state, p.block);
    if (
      n?.type !== "paragraph" ||
      !["doc", "cell", "list_item"].includes(parent?.type) ||
      p.offset !== state.replicas[n.text].length
    )
      throw fail(
        "Place the caret at the end of a paragraph to insert an image",
      );
    if (Object.values(state.nodes).some((n) => n.mediaSlot === intent.slot))
      throw fail("Image slot identity reused");
    return { point: p, parent };
  }
  if (intent.kind === "imageComplete") {
    if (
      !exact(intent, [
        "kind",
        "image",
        "generation",
        "asset",
        "mime",
        "bytes",
        "width",
        "height",
      ])
    )
      throw fail("Invalid image completion");
    if (
      typeof intent.asset !== "string" ||
      !/^[a-f0-9]{64}$/.test(intent.asset) ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        intent.mime,
      ) ||
      !Number.isInteger(intent.bytes) ||
      intent.bytes < 1 ||
      intent.bytes > 20 * 1024 * 1024
    )
      throw fail("Invalid durable image descriptor");
    for (const k of ["width", "height"])
      if (!Number.isInteger(intent[k]) || intent[k] < 1 || intent[k] > 10000)
        throw fail("Invalid image dimensions");
    const n = state.nodes[intent.image];
    if (
      !n?.live ||
      n.type !== "image" ||
      typeof intent.generation !== "string" ||
      state.pendingMedia?.[intent.image]?.generation !== intent.generation
    )
      throw fail("Image upload slot is no longer current");
    return { node: n };
  }
  if (intent.kind === "imageDelete") {
    if (!exact(intent, ["kind", "image"])) throw fail("Invalid image deletion");
    const n = state.nodes[intent.image];
    if (!n?.live || n.type !== "image" || !n.mediaSlot)
      throw fail("Image is unavailable");
    return { node: n };
  }
  throw fail("Unknown media command");
}
export function executeMedia(state, intent, action, host) {
  const { write, fail } = host;
  if (intent.kind === "imageInsert") {
    const { point, parent } = validateMedia(state, intent, host),
      id = action + ":image";
    if (state.nodes[id]) throw fail("Image identity reused");
    return createMediaImage(state, intent, action, parent, point.block, host);
  }

  if (intent.kind === "imageComplete") {
    const { node } = validateMedia(state, intent, host),
      n = {
        ...node,
        asset: intent.asset,
        assetDescriptor: {
          mime: intent.mime,
          bytes: intent.bytes,
          width: intent.width,
          height: intent.height,
        },
        width: intent.width,
        height: intent.height,
      };
    write("nodes")[n.id] = n;
    delete write("pendingMedia")[n.id];
    // A host-generated effect advances history but is never placed in user Undo.
    return { kind: "mediaNoop" };
  }
  if (intent.kind === "mediaNoop") return { kind: "mediaNoop" };
  if (intent.kind === "imageDelete") {
    const { node } = validateMedia(state, intent, host),
      parent = treeParent(state, node.id),
      position = parent.children.indexOf(node.id);
    return executeMedia(
      state,
      {
        kind: "imagePresence",
        image: node.id,
        parent: parent.id,
        after: parent.children[position - 1] || null,
        active: false,
        expected: node.imageOwner,
        sizeOwner: node.imageSizeOwner ?? null,
      },
      action,
      host,
    );
  }
  const node = state.nodes[intent.image],
    parent = state.nodes[intent.parent];
  if (
    !node ||
    node.imageOwner !== intent.expected ||
    (node.imageSizeOwner ?? null) !== (intent.sizeOwner ?? null) ||
    node.live === intent.active ||
    !parent?.live
  )
    throw fail("Image changed; cannot undo this action");
  if (!intent.active && treeParent(state, node.id)?.id !== parent.id)
    throw fail("Image moved; cannot undo this action");
  if (
    intent.active &&
    (intent.before
      ? !parent.children.includes(intent.before)
      : intent.after && !parent.children.includes(intent.after))
  )
    throw fail("Image insertion boundary was removed");
  const n = { ...node, live: intent.active, imageOwner: action };
  if (!intent.active) n.retiredBy = action;
  else delete n.retiredBy;
  write("nodes")[n.id] = n;
  const children = parent.children.filter((id) => id !== n.id);
  if (intent.active)
    children.splice(
      intent.before
        ? children.indexOf(intent.before)
        : intent.after
          ? children.indexOf(intent.after) + 1
          : 0,
      0,
      n.id,
    );
  write("nodes")[parent.id] = { ...parent, children };
  return { ...intent, active: !intent.active, expected: action };
}

// One invariant covers direct deletion, table/list deletion, cell clearing and
// their Undo: a newly live unresolved image must acquire a fresh generation.
// Only the sparse unresolved-image index is visited; prose typing never scans
// the document's full node collection for media.
export function fenceMedia(before, after, action, write) {
  for (const id of Object.keys(after.pendingMedia || {})) {
    const old = before.nodes[id],
      next = after.nodes[id];
    if (!old || !next || old.live === next.live || next.asset) continue;
    write("pendingMedia")[id] = { generation: next.live ? action : null };
  }
}

// This ledger is upload lifecycle state, not structural content. Keeping it out
// of image nodes lets generic structural Undo restore exact content snapshots.
export function validateMediaState(state, fail) {
  const pending = state.pendingMedia;
  if (
    pending !== undefined &&
    (!pending || typeof pending !== "object" || Array.isArray(pending))
  )
    fail("Invalid pending media ledger");
  for (const [id, entry] of Object.entries(pending || {})) {
    const node = state.nodes[id];
    if (
      !node ||
      node.type !== "image" ||
      !node.mediaSlot ||
      node.asset ||
      !exact(entry, ["generation"]) ||
      !Object.hasOwn(entry, "generation") ||
      (node.live
        ? typeof entry.generation !== "string" || !entry.generation
        : entry.generation !== null)
    )
      fail("Invalid pending media lifecycle");
  }
  const slots = new Set();
  for (const node of Object.values(state.nodes)) {
    if (!node.mediaSlot) continue; // Existing host-managed asset references remain readable.
    if (
      node.type !== "image" ||
      typeof node.mediaSlot !== "string" ||
      !/^[-\w]{16,80}$/.test(node.mediaSlot) ||
      slots.has(node.mediaSlot)
    )
      fail("Invalid image slot identity");
    slots.add(node.mediaSlot);
    if (!node.asset && !Object.hasOwn(pending || {}, node.id))
      fail("Missing pending media lifecycle");
    if (
      node.asset &&
      (typeof node.asset !== "string" || !/^[a-f0-9]{64}$/.test(node.asset))
    )
      fail("Invalid completed image asset");
  }
}

// Internal primitive: caller has validated its semantic placement and descriptor.
export function createMediaImage(
  state,
  intent,
  action,
  parent,
  after,
  host,
  before,
) {
  const { write, fail } = host,
    id = action + ":image";
  if (state.nodes[id]) throw fail("Image identity reused");
  const n = {
    id,
    type: "image",
    live: true,
    mediaSlot: intent.slot,
    createdBy: action,
    imageOwner: action,
    width: intent.width,
    height: intent.height,
    alt: "",
  };
  write("nodes")[id] = n;
  write("pendingMedia")[id] = { generation: action };
  const children = [...parent.children];
  const index =
    before !== undefined
      ? before === null
        ? children.length
        : children.indexOf(before)
      : children.indexOf(after) + 1;
  if (index < 0) throw fail("Image boundary unavailable");
  children.splice(index, 0, id);
  write("nodes")[parent.id] = { ...parent, children };
  return {
    kind: "imagePresence",
    image: id,
    parent: parent.id,
    after,
    ...(before ? { before } : {}),
    active: false,
    expected: action,
  };
}
