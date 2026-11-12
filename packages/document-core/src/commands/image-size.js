// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { imageSizeWitness, validateImageSize } from "../model/image-size.js";
export const previewImageSize = imageSizeWitness;
export function planImageSize(state, selection, op, { preview, width }) {
  const intent = {
    kind: "imageResize",
    image: preview?.image,
    expected: preview,
    width,
  };
  validateImageSize(state, intent);
  if ((preview.displayWidth ?? preview.width) === width)
    return { intent: null, state, selection };
  return { intent, state: apply(state, { ...op, intent }), selection };
}
