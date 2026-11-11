// SPDX-License-Identifier: MPL-2.0
import { seed } from "@cwhy/jade-core/model";

export function tableFixture() {
  const nodes = {};
  const add = (id, type, children, extra = {}) => {
    nodes[id] = {
      id,
      type,
      live: true,
      ...(children ? { children } : {}),
      ...extra,
    };
  };
  add("doc", "doc", ["table"]);
  add("table", "table", ["row", "row-two"]);
  add("row", "row", ["cell", "list-cell", "code-cell"]);
  add("row-two", "row", ["empty-cell", "image-cell", "last-cell"]);
  for (const [id, children] of [
    ["cell", ["first"]],
    ["list-cell", ["list"]],
    ["code-cell", ["code"]],
    ["empty-cell", ["empty"]],
    ["image-cell", ["image", "image-text"]],
    ["last-cell", ["last"]],
  ])
    add(id, "cell", children, { colwidth: [200] });
  add("list", "ordered_list", ["item"]);
  add("item", "list_item", ["list-text"]);
  add("image", "image", null, { asset: "fixture.png" });
  const content = {
    first: "First cell text",
    "list-text": "List cell text",
    code: "const value = 1;",
    empty: "",
    "image-text": "Image notes",
    last: "Last cell text",
  };
  for (const id of Object.keys(content))
    add(id, id === "code" ? "code" : "paragraph");
  return seed(
    nodes,
    Object.fromEntries(
      Object.entries(content).map(([id, text]) => [id, [{ text }]]),
    ),
  );
}
