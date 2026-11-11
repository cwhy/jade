// SPDX-License-Identifier: MPL-2.0
import { SLICE_MIME } from "@cwhy/jade-core/rich-slice";
import { MIME } from "@cwhy/jade-core/fragment";
import { GRID_MIME } from "@cwhy/jade-core/grid-fragment";
import { validateFragment, colors } from "@cwhy/jade-core/fragment";
export const MAX_CLIPBOARD_PAYLOAD = 2000000,
  MAX_CLIPBOARD_HTML = 8500000;
export function encodeClipboardHTML(type, payload, html) {
  if (
    ![MIME, GRID_MIME, SLICE_MIME].includes(type) ||
    typeof payload !== "string" ||
    payload.length > MAX_CLIPBOARD_PAYLOAD
  )
    throw Error("Clipboard payload is too large or unsupported");
  const envelope = encodeURIComponent(
      JSON.stringify({ version: 1, type, payload }),
    ),
    rich = `<div data-internal-doc-clipboard="${envelope}">${html}</div>`;
  if (rich.length > MAX_CLIPBOARD_HTML)
    throw Error("Clipboard HTML is too large");
  return rich;
}
export function decodeHTML(html, document) {
  if (html.length > 1000000) throw Error("Clipboard HTML is too large");
  const t = document.createElement("template");
  t.innerHTML = html;
  const notices = new Set(),
    blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      blocks.push({ type: "paragraph", content: current });
      current = [];
    }
  };
  function walk(node, style = []) {
    if (node.nodeType === 3) {
      if (
        !current.length &&
        !node.textContent.trim() &&
        /[\r\n]/.test(node.textContent)
      )
        return;
      if (node.textContent)
        current.push({ text: node.textContent, marks: style });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (
      ["script", "style", "iframe", "object", "embed", "svg", "math"].includes(
        tag,
      )
    ) {
      notices.add("Active or embedded content was removed");
      return;
    }
    if (
      ["table", "ul", "ol", "li", "img", "video", "audio", "pre"].includes(tag)
    )
      notices.add(
        "Lists, tables, media or code blocks need structural paste support",
      );
    if (
      ["h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "input"].includes(tag)
    )
      notices.add("Unsupported block styling requires conversion");
    if (tag === "br") {
      current.push({ text: "\n", marks: style });
      return;
    }
    if (
      ["p", "div"].includes(tag) &&
      node.childNodes.length === 1 &&
      node.firstChild.nodeName === "BR"
    ) {
      flush();
      blocks.push({ type: "paragraph", content: [] });
      return;
    }
    let next = [...style];
    const types = {
      b: "strong",
      strong: "strong",
      i: "em",
      em: "em",
      u: "underline",
      s: "strike",
      strike: "strike",
      del: "strike",
    };
    if (types[tag]) next.push({ type: types[tag] });
    if (
      node.style.fontWeight === "bold" ||
      Number(node.style.fontWeight) >= 600
    )
      next.push({ type: "strong" });
    if (node.style.fontStyle === "italic") next.push({ type: "em" });
    const color =
      node.style.backgroundColor || (tag === "mark" ? "yellow" : null);
    if (color) {
      if (colors.test(color))
        next.push({ type: "highlight", attrs: { color } });
      else notices.add("Unsupported highlight color");
    }
    const foreground = node.style.color;
    if (foreground) {
      if (colors.test(foreground))
        next.push({ type: "color", attrs: { color: foreground } });
      else notices.add("Unsupported text color");
    }
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:\/\/|mailto:)/i.test(href))
        next.push({ type: "link", attrs: { href } });
      else notices.add("Unsafe or unsupported link was removed");
    }
    next = [...new Map(next.map((m) => [m.type, m])).values()];
    const block = [
      "p",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "li",
      "tr",
      "pre",
    ].includes(tag);
    if (block) flush();
    const before = current.length;
    for (const child of node.childNodes) walk(child, next);
    if (tag === "td" || tag === "th") current.push({ text: "\t", marks: [] });
    if (block) {
      if (current.length === before && !node.children.length)
        current.push({ text: "", marks: next });
      flush();
    }
  }
  for (const node of t.content.childNodes) walk(node);
  flush();
  return {
    fragment: validateFragment({
      version: 1,
      blocks: blocks.length ? blocks : [{ type: "paragraph", content: [] }],
    }),
    notices: [...notices],
  };
}

// This is a transport envelope, not a trusted document. Existing fragment,
// operation and asset validators still run before anything can be committed.
export function clipboardEnvelope(html, document) {
  if (!html.includes("data-internal-doc-clipboard")) return null;
  if (html.length > MAX_CLIPBOARD_HTML)
    throw Error("Clipboard HTML is too large");
  const t = document.createElement("template");
  t.innerHTML = html;
  const nodes = t.content.querySelectorAll("[data-internal-doc-clipboard]");
  if (!nodes.length) return null;
  if (nodes.length !== 1) throw Error("Ambiguous internal clipboard content");
  let envelope;
  try {
    envelope = JSON.parse(
      decodeURIComponent(nodes[0].getAttribute("data-internal-doc-clipboard")),
    );
  } catch {
    throw Error("Invalid internal clipboard content");
  }
  if (
    envelope?.version !== 1 ||
    ![MIME, GRID_MIME, SLICE_MIME].includes(envelope.type) ||
    typeof envelope.payload !== "string" ||
    envelope.payload.length > MAX_CLIPBOARD_PAYLOAD
  )
    throw Error("Invalid internal clipboard content");
  return envelope;
}
