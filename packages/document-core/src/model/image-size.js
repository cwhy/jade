// SPDX-License-Identifier: MPL-2.0
import { treeParent } from "./tree.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function imageSizeWitness(state, image, fail = (m) => Error(m)) {
  const n = state.nodes[image],
    parent = treeParent(state, image);
  if (!n?.live || n.type !== "image" || !n.asset || !parent)
    throw fail("A completed image is required for resizing");
  return {
    image,
    parent: parent.id,
    asset: n.asset,
    presence: n.imageOwner ?? null,
    width: n.width || 180,
    height: n.height || 50,
    displayWidth: n.displayWidth ?? null,
    owner: n.imageSizeOwner ?? null,
  };
}
export function validateImageSize(state, intent, fail = (m) => Error(m)) {
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "image", "expected", "width"].includes(k),
    ) ||
    !Number.isSafeInteger(intent.width) ||
    intent.width < 48 ||
    intent.width > 10000
  )
    throw fail("Image width must be an integer between 48 and 10000 pixels");
  const current = imageSizeWitness(state, intent.image, fail);
  if (!same(current, intent.expected))
    throw fail("Image changed; start resizing again");
  return current;
}
export function executeImageSize(state, intent, action, { write, fail }) {
  const current = imageSizeWitness(state, intent.image, fail);
  // Public previews bind the current presence generation. Owned size Undo is
  // different: deleting and restoring the same image does not replace its size
  // contribution. Still require the exact asset, parent, dimensions and size
  // owner so another resize cannot be overwritten after restoration.
  const expected =
    intent.kind === "restoreImageSize"
      ? { ...intent.expected, presence: current.presence }
      : intent.expected;
  if (!same(current, expected))
    throw fail("Image changed; resize Undo/Redo cannot overwrite it");
  const n = { ...state.nodes[intent.image] },
    width = intent.kind === "imageResize" ? intent.width : intent.value.width,
    owner = intent.kind === "imageResize" ? action : intent.value.owner;
  if (width === null) delete n.displayWidth;
  else n.displayWidth = width;
  if (owner === null) delete n.imageSizeOwner;
  else n.imageSizeOwner = owner;
  write("nodes")[n.id] = n;
  return {
    kind: "restoreImageSize",
    image: n.id,
    expected: imageSizeWitness(state, n.id),
    value: { width: current.displayWidth, owner: current.owner },
  };
}
export function validateImageSizes(state, fail) {
  for (const n of Object.values(state.nodes)) {
    if (
      n.displayWidth !== undefined &&
      (n.type !== "image" ||
        !Number.isSafeInteger(n.displayWidth) ||
        n.displayWidth < 48 ||
        n.displayWidth > 10000)
    )
      fail("Invalid image display width");
    if (
      n.imageSizeOwner !== undefined &&
      (n.type !== "image" ||
        typeof n.imageSizeOwner !== "string" ||
        !n.imageSizeOwner ||
        n.displayWidth === undefined)
    )
      fail("Invalid image size ownership");
  }
}

export function imageCopy(node) {
  return Object.fromEntries(
    ["type", "asset", "alt", "width", "height", "displayWidth"]
      .filter((k) => node[k] !== undefined)
      .map((k) => [k, node[k]]),
  );
}
