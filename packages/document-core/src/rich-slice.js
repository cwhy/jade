// SPDX-License-Identifier: MPL-2.0
// A clipboard slice is transferable content, never a document/storage snapshot.
// Reuse the rich-cell content validator so lists, code and asset references have
// one schema. The temporary one-cell wrapper is not serialized or exposed as UI.
import { validateGridFragment } from "./grid-fragment.js";
import { htmlText } from "./fragment.js";
export const SLICE_MIME = "application/x-internal-doc-slice+json";
export function validateRichSlice(value) {
  if (
    !value ||
    value.version !== 1 ||
    Object.keys(value).some((k) => !["version", "blocks", "edges"].includes(k))
  )
    throw Error("Invalid rich clipboard slice");
  const edges = value.edges;
  if (
    !edges ||
    Object.keys(edges).length !== 2 ||
    !["boundary", "partial"].includes(edges.start) ||
    !["boundary", "partial"].includes(edges.end)
  )
    throw Error("Invalid clipboard slice edges");
  const blocks = validateGridFragment({ version: 1, rows: [[value.blocks]] })
    .rows[0][0];
  return { version: 1, edges: { start: edges.start, end: edges.end }, blocks };
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function sliceHTML(value) {
  const slice = validateRichSlice(value);
  function block(b) {
    if (b.content) return htmlText({ version: 1, blocks: [b] });
    if (b.type === "image")
      return `<p>[Image: ${escape(b.alt || b.asset)}]</p>`;
    const tag = { ordered_list: "ol", bullet_list: "ul", list_item: "li" }[
      b.type
    ];
    return `<${tag}${b.type === "ordered_list" ? ` start="${b.order || 1}"` : ""}>${b.children.map(block).join("")}</${tag}>`;
  }
  return slice.blocks.map(block).join("");
}
export function slicePlainText(value) {
  const slice = validateRichSlice(value);
  function block(b, depth = 0) {
    if (b.content) return b.content.map((c) => c.text).join("");
    if (b.type === "image") return `[Image: ${b.alt || b.asset}]`;
    if (["ordered_list", "bullet_list"].includes(b.type))
      return b.children
        .map((item, i) => {
          const [first, ...rest] = item.children;
          return (
            "  ".repeat(depth) +
            (b.type === "ordered_list" ? `${(b.order || 1) + i}. ` : "• ") +
            block(first, depth) +
            rest.map((c) => "\n" + block(c, depth + 1)).join("")
          );
        })
        .join("\n");
    return b.children.map((c) => block(c, depth)).join("\n");
  }
  return slice.blocks.map((b) => block(b)).join("\n");
}
