// SPDX-License-Identifier: MPL-2.0
import {
  CELL_STYLE_PROPERTIES,
  checkTableStyle,
} from "./model/table-format.js";
import { marks, htmlText } from "./fragment.js";
export const GRID_MIME = "application/x-internal-doc-grid+json";
const object = (x) => x && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) => {
  if (!object(x) || Object.keys(x).some((k) => !keys.includes(k)))
    throw Error("Unsupported clipboard fields");
};
// Limits bound an untrusted clipboard conversion, not production document size.
export function validateGridFragment(value) {
  exact(value, ["version", "rows", ...(value.version === 2 ? ["styles"] : [])]);
  if (
    ![1, 2].includes(value.version) ||
    !Array.isArray(value.rows) ||
    !value.rows.length ||
    value.rows.length > 100
  )
    throw Error("Invalid clipboard grid");
  const columns = value.rows[0]?.length;
  let nodes = 0,
    size = 0,
    runs = 0;
  if (
    !columns ||
    columns > 20 ||
    value.rows.some((r) => !Array.isArray(r) || r.length !== columns)
  )
    throw Error("Clipboard requires a regular grid");
  function block(b, depth = 0, item = false) {
    if (++nodes > 10000 || depth > 16)
      throw Error("Clipboard structure is too large");
    if (!object(b)) throw Error("Invalid clipboard block");
    const t = b.type;
    if (
      (item && t !== "list_item") ||
      (!item &&
        !["paragraph", "code", "image", "bullet_list", "ordered_list"].includes(
          t,
        ))
    )
      throw Error("Unsupported clipboard structure");
    if (["paragraph", "code"].includes(t)) {
      exact(b, ["type", "content", ...(t === "code" ? ["language"] : [])]);
      if (!Array.isArray(b.content)) throw Error("Invalid clipboard text");
      const content = b.content.map((c) => {
        exact(c, ["text", "marks"]);
        if (++runs > 100000) throw Error("Too many clipboard text runs");
        if (typeof c.text !== "string" || (size += c.text.length) > 1000000)
          throw Error("Clipboard text is too large");
        return {
          text: c.text.replace(/\r\n?/g, "\n"),
          marks: marks(c.marks || []),
        };
      });
      if (
        b.language !== undefined &&
        (typeof b.language !== "string" || !/^[-\w+#.]{1,64}$/.test(b.language))
      )
        throw Error("Invalid code language");
      return {
        type: t,
        content,
        ...(b.language !== undefined ? { language: b.language } : {}),
      };
    }
    if (t === "image") {
      exact(b, ["type", "asset", "alt", "width", "height", "displayWidth"]);
      if (
        b.displayWidth !== undefined &&
        (!Number.isSafeInteger(b.displayWidth) ||
          b.displayWidth < 48 ||
          b.displayWidth > 10000)
      )
        throw Error("Invalid image display width");
      if (typeof b.asset !== "string" || !b.asset || b.asset.length > 512)
        throw Error("Invalid image asset reference");
      if (
        b.alt !== undefined &&
        (typeof b.alt !== "string" || b.alt.length > 4096)
      )
        throw Error("Invalid image description");
      for (const k of ["width", "height"])
        if (
          b[k] !== undefined &&
          (!Number.isFinite(b[k]) || b[k] <= 0 || b[k] > 10000)
        )
          throw Error("Invalid image dimensions");
      return { ...b };
    }
    exact(b, ["type", "children", ...(t === "ordered_list" ? ["order"] : [])]);
    if (!Array.isArray(b.children) || !b.children.length)
      throw Error("Empty clipboard container");
    if (
      b.order !== undefined &&
      (!Number.isSafeInteger(b.order) || b.order < 1 || b.order > 1000000)
    )
      throw Error("Invalid list numbering");
    const children = b.children.map((c) =>
      block(c, depth + 1, t !== "list_item"),
    );
    if (t === "list_item" && children[0].type !== "paragraph")
      throw Error("List item requires a first paragraph");
    return {
      type: t,
      children,
      ...(b.order !== undefined ? { order: b.order } : {}),
    };
  }
  let styles;
  if (value.version === 2) {
    if (
      !Array.isArray(value.styles) ||
      value.styles.length !== value.rows.length ||
      value.styles.some((row) => !Array.isArray(row) || row.length !== columns)
    )
      throw Error("Invalid clipboard style grid");
    styles = value.styles.map((row) =>
      row.map((style) => {
        exact(style, CELL_STYLE_PROPERTIES);
        if (CELL_STYLE_PROPERTIES.some((key) => !Object.hasOwn(style, key)))
          throw Error("Incomplete clipboard cell style");
        for (const [key, v] of Object.entries(style)) checkTableStyle(key, v);
        return Object.fromEntries(
          CELL_STYLE_PROPERTIES.map((key) => [key, style[key]]),
        );
      }),
    );
  }
  return {
    version: value.version,
    ...(styles ? { styles } : {}),
    rows: value.rows.map((r) =>
      r.map((cell) => {
        if (!Array.isArray(cell) || !cell.length)
          throw Error("Empty clipboard cell");
        return cell.map((b) => block(b));
      }),
    ),
  };
}
export function gridAssets(fragment) {
  const assets = new Set();
  function walk(b) {
    if (b.type === "image") assets.add(b.asset);
    for (const c of b.children || []) walk(c);
  }
  for (const row of fragment.rows)
    for (const cell of row) for (const b of cell) walk(b);
  return [...assets];
}
export function validateGridAssets(state, fragment) {
  const owned = new Set(
    Object.values(state.nodes)
      .filter((n) => n.type === "image" && n.asset)
      .map((n) => n.asset),
  );
  for (const asset of gridAssets(fragment))
    if (!owned.has(asset))
      throw Error(
        "Image is unavailable in this document; cross-document media transfer is not ready",
      );
}
export function gridPlainText(fragment) {
  function block(b, depth = 0) {
    if (b.content) return b.content.map((c) => c.text).join("");
    if (b.type === "image") return `[Image: ${b.alt || b.asset}]`;
    if (["ordered_list", "bullet_list"].includes(b.type))
      return b.children
        .map(
          (c, i) =>
            "  ".repeat(depth) +
            (b.type === "ordered_list" ? `${(b.order || 1) + i}. ` : "• ") +
            c.children.map((x) => block(x, depth + 1)).join("\n"),
        )
        .join("\n");
    return b.children.map((c) => block(c, depth)).join("\n");
  }
  // Quote embedded tabs/newlines for a lossless, readable tabular text fallback.
  const quote = (s) =>
    /[\t\n"]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  return fragment.rows
    .map((row) =>
      row.map((cell) => quote(cell.map((b) => block(b)).join("\n"))).join("\t"),
    )
    .join("\n");
}
export function gridHTML(fragment) {
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function block(b) {
    if (b.content) {
      const html = htmlText({ version: 1, blocks: [b] });
      return b.type === "code"
        ? html.replace("<pre", '<pre style="text-align:left"')
        : html;
    }
    if (b.type === "image")
      return `<p>[Image: ${escape(b.alt || b.asset)}]</p>`;
    const tag = { ordered_list: "ol", bullet_list: "ul", list_item: "li" }[
      b.type
    ];
    return `<${tag}${b.type === "ordered_list" ? ` start="${b.order || 1}"` : ""}>${b.children.map(block).join("")}</${tag}>`;
  }
  fragment = validateGridFragment(fragment);
  const css = (i, j) => {
    const s = fragment.styles?.[i][j];
    return s
      ? ` style="background-color:${s.background ?? "transparent"};vertical-align:${s.verticalAlign ?? "top"};text-align:${s.textAlign ?? "left"}"`
      : "";
  };
  return `<table>${fragment.rows.map((row, i) => `<tr>${row.map((cell, j) => `<td${css(i, j)}>${cell.map(block).join("")}</td>`).join("")}</tr>`).join("")}</table>`;
}
// Explicit selected-cell plain-text input; never interpret formulas or Markdown.
export function gridFromText(value) {
  if (typeof value !== "string" || value.length > 1000000)
    throw Error("Clipboard text is too large");
  const rows = [[]];
  let cell = "",
    quoted = false,
    afterQuote = false;
  function end() {
    rows
      .at(-1)
      .push([{ type: "paragraph", content: [{ text: cell, marks: [] }] }]);
    cell = "";
    afterQuote = false;
  }
  value = value.replace(/\r\n?/g, "\n");
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === '"') {
        if (value[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += c;
    } else if (c === "\t" || c === "\n") {
      end();
      if (c === "\n") rows.push([]);
    } else if (c === '"' && !cell && !afterQuote) quoted = true;
    else {
      if (afterQuote) throw Error("Malformed quoted clipboard cell");
      cell += c;
    }
  }
  if (quoted) throw Error("Unclosed clipboard cell quote");
  end();
  if (value.endsWith("\n") && rows.length > 1) rows.pop();
  return validateGridFragment({ version: 1, rows });
}
