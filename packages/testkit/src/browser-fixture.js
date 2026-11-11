// SPDX-License-Identifier: MPL-2.0
import { seed } from "@cwhy/jade-core/model";
export function fixture() {
  const nodes = {
    doc: { id: "doc", type: "doc", children: ["table"], live: true },
    table: { id: "table", type: "table", children: ["row"], live: true },
    row: {
      id: "row",
      type: "row",
      children: ["cell", "other-cell"],
      live: true,
    },
    cell: {
      id: "cell",
      type: "cell",
      children: ["first", "list", "tail", "code", "image"],
      live: true,
    },
    "other-cell": {
      id: "other-cell",
      type: "cell",
      children: ["other"],
      live: true,
    },
    list: {
      id: "list",
      type: "ordered_list",
      children: ["a", "b", "c"],
      live: true,
    },
    nestedList: {
      id: "nestedList",
      type: "bullet_list",
      children: ["child"],
      live: true,
    },
    child: {
      id: "child",
      type: "list_item",
      children: ["childp", "child-code"],
      live: true,
    },
    image: { id: "image", type: "image", asset: "fixture.png", live: true },
  };
  for (const id of ["a", "b", "c"]) {
    nodes[id] = {
      id,
      type: "list_item",
      children: [id + "p", ...(id === "a" ? ["nestedList"] : [])],
      live: true,
    };
  }
  for (const id of [
    "first",
    "ap",
    "bp",
    "cp",
    "childp",
    "tail",
    "other",
    "code",
    "child-code",
  ])
    nodes[id] = {
      id,
      type: ["code", "child-code"].includes(id) ? "code" : "paragraph",
      ...(["code", "child-code"].includes(id)
        ? { language: "javascript" }
        : {}),
      live: true,
    };
  return seed(nodes, {
    first: [
      { text: "LEFT" },
      { text: "TARGET", marks: ["em"] },
      { text: "RIGHT" },
    ],
    ap: [{ text: "Review rollout", marks: ["strong"] }],
    bp: [{ text: "Check retry behavior", marks: ["em"] }],
    cp: [{ text: "Share test notes" }],
    childp: [{ text: "Confirm existing work" }],
    tail: [{ text: "Next update after verification." }],
    other: [{ text: "Notes from a second teammate" }],
    code: [{ text: "const retries = 2;" }],
    "child-code": [{ text: "const retries = 2;" }],
  });
}

// Explicit child-paste variant; the default regression fixture is unchanged.
export function childPasteFixture({
  legacyHighlight = false,
  reverse = false,
} = {}) {
  const state = fixture();
  state.nodes.nestedList.type = "ordered_list";
  state.nodes.nestedList.order = 1;
  if (reverse) state.nodes.list.type = "bullet_list";
  if (legacyHighlight)
    state.runs["seed:ap"].formats[0].marks.push({
      type: "highlight",
      color: "#fff0a8",
    });
  return state;
}

export function attachmentFixture() {
  const state = fixture();
  state.nodes.cell.children = state.nodes.cell.children.filter(
    (id) => !["code", "image"].includes(id),
  );
  state.nodes.b.children.push("code", "image");
  return state;
}
