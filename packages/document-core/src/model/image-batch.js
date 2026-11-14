// SPDX-License-Identifier: MPL-2.0
import { validateMedia } from "./media.js";
import { validateImagePlacement } from "./image-placement.js";
import { validateImageFlow } from "./image-flow.js";
const placements = ["imageInsert", "imagePlace", "imageListPlace"];
export function validateImageBatch(state, intent, host) {
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "placement", "at", "ids", "images"].includes(k),
    ) ||
    !placements.includes(intent.placement) ||
    !Array.isArray(intent.images) ||
    intent.images.length < 2 ||
    intent.images.length > 16 ||
    new Set(intent.images.map((i) => i?.slot)).size !== intent.images.length ||
    (intent.placement !== "imagePlace" && intent.ids !== undefined)
  )
    throw host.fail("Invalid image group");
  for (const image of intent.images) {
    if (
      !image ||
      typeof image !== "object" ||
      Array.isArray(image) ||
      Object.keys(image).some((k) => !["slot", "width", "height"].includes(k))
    )
      throw host.fail("Invalid image descriptor");
    const part = {
      kind: intent.placement,
      at: intent.at,
      ...image,
      ...(intent.placement === "imagePlace" ? { ids: intent.ids } : {}),
    };
    if (part.kind === "imageListPlace") validateImageFlow(state, part, host);
    else {
      const local = {
        resolve: (at) => host.resolveState(state, at),
        gap: (id, offset) => host.gapState(state, id, offset),
        fail: host.fail,
      };
      if (part.kind === "imagePlace")
        validateImagePlacement(state, part, local);
      else validateMedia(state, part, local);
    }
  }
}
export function executeImageBatch(state, intent, action, host) {
  validateImageBatch(state, intent, host);
  const flow = intent.placement === "imageListPlace",
    images = flow ? intent.images : [...intent.images].reverse(),
    source = host.resolveState(state, intent.at).block,
    inverses = [];
  let at = intent.at;
  for (let i = 0; i < images.length; i++) {
    const kind = i
      ? flow
        ? "imageListPlace"
        : "imageInsert"
      : intent.placement;
    inverses.unshift(
      host.execute(
        {
          kind,
          at,
          ...images[i],
          ...(kind === "imagePlace" ? { ids: intent.ids } : {}),
        },
        `${action}:part:${i}`,
      ),
    );
    if (!flow)
      at = host.gapState(
        state,
        source,
        state.replicas[state.nodes[source].text].length,
      );
  }
  return { kind: "batch", intents: inverses };
}
