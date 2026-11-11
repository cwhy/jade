// SPDX-License-Identifier: MPL-2.0
import { listMarkers } from "@cwhy/jade-core/list-marker";
import { text } from "@cwhy/jade-core/model";
import { htmlText } from "@cwhy/jade-core/fragment";

// Stable block elements. Replica/formats identities are invalidation keys, never
// text equality: equal strings can have different identities, styles or Undo.
export function createDocumentRenderer(
  root,
  {
    resolveAsset = () => null,
    imageAlt = (node) => node.alt || "Image",
    cellHandles = false,
  } = {},
) {
  const document = root.ownerDocument,
    entries = new Map();
  const tags = {
    doc: "div",
    table: "table",
    row: "tr",
    cell: "td",
    paragraph: "p",
    code: "pre",
    ordered_list: "ol",
    bullet_list: "ul",
    list_item: "li",
    image: "figure",
  };
  const render = (state) => {
    const visited = new Set(),
      headerCells = new Set();
    function node(id, depth = 0) {
      const n = state.nodes[id];
      if (!n?.live || visited.has(id) || !tags[n.type])
        throw Error("Invalid rendered structure");
      visited.add(id);
      let entry = entries.get(id);
      if (!entry || entry.type !== n.type) {
        entry = { element: document.createElement(tags[n.type]), type: n.type };
        entry.element.dataset.node = id;
        if (n.text) {
          entry.element.dataset.block = id;
          entry.element.style.whiteSpace = "pre-wrap";
        }
        entries.set(id, entry);
      }
      const el = entry.element;
      if (n.type === "table") {
        if (n.headerRow === true)
          for (const cell of state.nodes[n.children[0]].children)
            headerCells.add(cell);
        // Stored widths are column widths, not flex weights. A new column must
        // grow the table rather than redistribute the old 100% container width.
        const first = state.nodes[n.children[0]],
          width =
            first.children.reduce(
              (sum, id) => sum + (state.nodes[id].colwidth?.[0] ?? 200),
              0,
            ) + "px";
        if (el.style.width !== width) el.style.width = width;
        if (el.style.tableLayout !== "fixed") el.style.tableLayout = "fixed";
      }
      if (n.type === "cell") {
        el.toggleAttribute("data-header-cell", headerCells.has(id));
        el.setAttribute("role", headerCells.has(id) ? "columnheader" : "cell");
      }
      if (n.text) {
        const replica = state.replicas[n.text];
        if (entry.replica !== replica || entry.formats !== state.formats) {
          const atoms = text(state, id);
          {
            // One DOM run per adjacent equal style, rather than per character.
            const runs = [];
            for (const atom of atoms) {
              const key = JSON.stringify(atom.marks),
                last = runs.at(-1);
              if (last?.key === key) last.text += atom.char;
              else
                runs.push({
                  key,
                  text: atom.char,
                  marks: atom.marks.map((m) =>
                    typeof m === "string"
                      ? { type: m }
                      : { type: m.type, attrs: m.attrs || m },
                  ),
                });
            }
            const template = document.createElement("template");
            template.innerHTML = htmlText({
              version: 1,
              blocks: [{ type: "paragraph", content: runs }],
            });
            // Selection uses text-node code points. Clipboard HTML represents
            // soft breaks as BR, but editable DOM must retain the model LF.
            if (atoms.length)
              for (const br of template.content.querySelectorAll("br"))
                br.replaceWith(document.createTextNode("\n"));
            el.replaceChildren(...template.content.firstChild.childNodes);
          }
          entry.replica = replica;
          entry.formats = state.formats;
        }
      }
      if (entry.node !== n) {
        // Table row height is a minimum in native table layout; never clip cells.
        if (n.type === "row")
          el.style.height = n.minHeight === undefined ? "" : n.minHeight + "px";
        if (n.type === "ordered_list") el.start = n.order || 1;
        if (n.type === "cell") {
          el.style.boxSizing = "border-box";
          el.colSpan = n.colspan || 1;
          el.rowSpan = n.rowspan || 1;
          el.style.width = n.colwidth?.length
            ? n.colwidth.reduce((a, b) => a + b, 0) + "px"
            : "";
          el.style.backgroundColor = n.background || "";
          el.style.verticalAlign = n.verticalAlign || "";
          el.style.textAlign = n.textAlign || "";
        }
        if (n.type === "image") {
          el.contentEditable = "false";
          const img = el.firstElementChild || document.createElement("img");
          // Asset authorization and URL policy belong to the application host.
          const source = resolveAsset(n);
          if (source == null) img.removeAttribute("src");
          else img.src = source;
          img.alt = imageAlt(n);
          img.width = n.width || 180;
          img.height = n.height || 50;
          if (!img.parentNode) el.append(img);
        }
        entry.node = n;
      }
      if (n.children) {
        const isList = ["ordered_list", "bullet_list"].includes(n.type),
          children = n.children.map((id) => node(id, depth + (isList ? 1 : 0))),
          wanted = new Set(children);
        if (isList)
          for (const [i, m] of listMarkers(state, n.id).entries()) {
            const li = children[i];
            li.dataset.markerKind = m.type;
            li.style.listStyleType =
              m.type === "ordered_list"
                ? ["decimal", "lower-alpha", "lower-roman"][depth % 3]
                : ["disc", "circle", "square"][depth % 3];
            if (m.number !== undefined) {
              li.value = m.number;
              li.dataset.markerValue = String(m.number);
            } else {
              li.removeAttribute("value");
              delete li.dataset.markerValue;
            }
          }
        children.forEach((child, i) => {
          if (el.children[i] !== child)
            el.insertBefore(child, el.children[i] || null);
        });
        // Composition at a structural gap can leave native text nodes between
        // blocks. Reconciliation removes those too, not only element children.
        for (const child of [...el.childNodes])
          if (!wanted.has(child) && child !== entry.handle) child.remove();
        if (cellHandles && n.type === "cell") {
          if (!entry.handle) {
            const button = document.createElement("button");
            button.type = "button";
            button.contentEditable = "false";
            button.dataset.cellHandle = id;
            button.setAttribute("aria-label", "Select cell");
            button.title = "Select cell; Shift-click to extend";
            button.textContent = "▦";
            entry.handle = button;
          }
          if (el.lastChild !== entry.handle) el.append(entry.handle);
        }
      }
      return el;
    }
    const content = node(state.root);
    if (root.firstChild !== content) root.replaceChildren(content);
    for (const id of entries.keys()) if (!visited.has(id)) entries.delete(id);
  };
  // Native composition owns DOM temporarily, including cancellation without a
  // model transaction. Reconcile that DOM even when model identities are equal.
  render.invalidate = () => {
    for (const entry of entries.values()) entry.replica = undefined;
  };
  return render;
}
