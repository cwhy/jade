// SPDX-License-Identifier: MPL-2.0
// Explicit supported slice: inline marks, paragraphs and literal code destinations.
// Unsupported structure is reviewed; never flattened by the rich path.
export const MIME = "application/x-internal-doc-fragment+json";
const supported = new Set([
  "strong",
  "em",
  "underline",
  "strike",
  "highlight",
  "color",
  "link",
]);
export const colors =
  /^(#[\da-f]{3,8}|yellow|blue|red|green|pink|orange|purple|gray|grey|transparent|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
export function marks(input) {
  if (!Array.isArray(input) || input.length > 12)
    throw Error("Invalid clipboard marks");
  return input.map((m) => {
    const type = typeof m === "string" ? m : m?.type;
    if (!supported.has(type)) throw Error("Unsupported clipboard mark");
    if (type === "link") {
      const href = m.attrs?.href;
      if (typeof href !== "string" || !/^(https?:\/\/|mailto:)/i.test(href))
        throw Error("Unsafe clipboard link");
      return { type, attrs: { href } };
    }
    if (type === "highlight" || type === "color") {
      const color = m.attrs?.color;
      if (typeof color !== "string" || !colors.test(color))
        throw Error("Unsupported clipboard highlight");
      return { type, attrs: { color } };
    }
    return { type };
  });
}
export function validateFragment(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length < 1 ||
    value.blocks.length > 64
  )
    throw Error("Invalid clipboard fragment");
  let size = 0;
  return {
    version: 1,
    blocks: value.blocks.map((b) => {
      if (!["paragraph", "code"].includes(b.type) || !Array.isArray(b.content))
        throw Error("Unsupported clipboard structure");
      return {
        type: b.type,
        content: b.content.map((c) => {
          if (typeof c.text !== "string" || (size += c.text.length) > 100000)
            throw Error("Clipboard fragment is too large");
          return {
            text: c.text.replace(/\r\n?/g, "\n"),
            marks: marks(c.marks || []),
          };
        }),
      };
    }),
  };
}
export function plainFragment(value, style = []) {
  if (typeof value !== "string" || value.length > 100000)
    throw Error("Clipboard text is too large");
  return {
    version: 1,
    blocks: value
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((text) => ({
        type: "paragraph",
        content: [{ text, marks: marks(style) }],
      })),
  };
}
export function plainText(fragment) {
  return fragment.blocks
    .map((b) => b.content.map((c) => c.text).join(""))
    .join("\n");
}
const escape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function htmlText(fragment) {
  return fragment.blocks
    .map((b) => {
      const text = b.content
        .map((c) => {
          let s = escape(c.text).replace(/\n/g, "<br>");
          for (const m of marks(c.marks || [])) {
            const type = m.type;
            if (type === "link")
              s = `<a href="${escape(m.attrs.href)}">${s}</a>`;
            else if (type === "color")
              s = `<span style="color:${escape(m.attrs.color)}">${s}</span>`;
            else if (type === "highlight")
              s = `<mark style="background-color:${escape(m.attrs.color)}">${s}</mark>`;
            else {
              const tag = {
                strong: "strong",
                em: "em",
                underline: "u",
                strike: "s",
              }[type];
              s = `<${tag}>${s}</${tag}>`;
            }
          }
          return s;
        })
        .join("");
      return b.type === "code"
        ? `<pre>${text}</pre>`
        : `<p>${text || "<br>"}</p>`;
    })
    .join("");
}
