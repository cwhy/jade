// SPDX-License-Identifier: MPL-2.0
import { seed } from "@cwhy/jade-core/model";
import { immutable } from "@cwhy/jade-core/immutability";
export function listFixture({
  cell = false,
  parent = false,
  empty = false,
  rich = false,
} = {}) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: cell ? ["table"] : ["list"],
    },
    list: {
      id: "list",
      type: "ordered_list",
      live: true,
      children: ["a", "b", "c"],
    },
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: {
        id: "row",
        type: "row",
        live: true,
        children: ["cell", "other-cell"],
      },
      cell: { id: "cell", type: "cell", live: true, children: ["list"] },
      "other-cell": {
        id: "other-cell",
        type: "cell",
        live: true,
        children: ["other"],
      },
      other: { id: "other", type: "paragraph", live: true },
    });
  const contents = {};
  for (const id of ["a", "b", "c"]) {
    nodes[id] = { id, type: "list_item", live: true, children: [id + "p"] };
    nodes[id + "p"] = { id: id + "p", type: "paragraph", live: true };
    contents[id + "p"] = [
      {
        text: empty && id === "b" ? "" : id.repeat(4),
        marks: id === "a" ? ["em"] : [],
      },
    ];
  }
  if (cell) contents.other = [{ text: "other cell" }];
  if (parent) {
    nodes.a.children.push("nested");
    nodes.nested = {
      id: "nested",
      type: "bullet_list",
      live: true,
      children: ["child"],
    };
    nodes.child = {
      id: "child",
      type: "list_item",
      live: true,
      children: ["childp"],
    };
    nodes.childp = { id: "childp", type: "paragraph", live: true };
    contents.childp = [{ text: "child" }];
  }
  if (rich) {
    nodes.b.children.push("code", "image");
    nodes.code = { id: "code", type: "code", language: "js", live: true };
    nodes.image = { id: "image", type: "image", asset: "mock.png", live: true };
    contents.code = [{ text: "const a=1;" }];
  }
  return immutable(seed(nodes, contents));
}
