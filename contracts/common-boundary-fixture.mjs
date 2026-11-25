// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import {
  seed,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { documentView } from "@cwhy/jade-core/document-read";
import {
  previewConversion,
  planConversion,
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import {
  planDelete,
  planEnter,
  planCodeLanguage,
  codeLanguageState,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
function fixture(parent, kind, options = {}) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: [] },
    a: { id: "a", type: "paragraph", live: true },
    b: { id: "b", type: "paragraph", live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: [] },
    });
  }
  nodes[parent].children = kind === "two-lists" ? ["la", "lb"] : ["a", "lb"];
  for (const id of [...(kind === "two-lists" ? ["a", "b"] : ["b"]), ...(options.third ? ["c"] : [])])
    Object.assign(nodes, {
      ["l" + id]: {
        id: "l" + id,
        type: "ordered_list",
        live: true,
        children: ["i" + id],
      },
      ["i" + id]: {
        id: "i" + id,
        type: "list_item",
        live: true,
        children: [id],
      },
    });
  if (options.third) { nodes.c={id:"c",type:"paragraph",live:true};nodes[parent].children.push("lc"); }
  if (options.barrier) {
    nodes.image = { id: "image", type: "image", live: true, asset: "mock.png" };
    nodes[parent].children.splice(1, 0, "image");
  }
  if (options.tail) {
    nodes.lb.children.push("id");
    nodes.id = { id: "id", type: "list_item", live: true, children: ["d"] };
    nodes.d = { id: "d", type: "paragraph", live: true };
  }
  const padding={};
  for(let i=0;i<(options.contextParagraphs||0);i++){
    const id='context-'+i;nodes[id]={id,type:'paragraph',live:true};nodes[parent].children.push(id);padding[id]=[{text:'word '.repeat(100)}];
  }
  let room = new Room(
      seed(nodes, {
        ...padding,
        a: [{ text: options.empty === "a" ? "" : (options.aText ?? "Alpha") }],
        b: [{ text: options.empty === "b" ? "" : (options.bText ?? "Beta") }],
        ...(options.third ? {c:[{text:"Gamma"}]} : {}),
        ...(options.tail ? { d: [{ text: "Verify" }] } : {}),
      }),
    ),
    journal = room.snapshot();
  const seqs = new Map();
  const auth = {
    parent,
    kind,
    snapshot() {
      return room.snapshot();
    },
    get state() {
      return room.record.state;
    },
    header(actor) {
      const seq = (seqs.get(actor) || 0) + 1;
      seqs.set(actor, seq);
      return {
        id: `${actor}:s:${seq}`,
        actor,
        stream: "s",
        seq,
        epoch: 1,
        modelVersion: 2,
      };
    },
    accept(op) {
      const r = room.accept(op);
      assert.equal(r.outcome, "accepted", r.reason);
      journal = replay(journal, { op, receipt: r });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(op), r);
      assert.deepEqual(room.snapshot(), journal);
      return op;
    },
    reject(op) {
      const before = JSON.stringify(room.record.state),
        r = room.accept(op);
      assert.equal(r.outcome, "rejected");
      assert.equal(JSON.stringify(room.record.state), before);
      journal = replay(journal,{op,receipt:r});
      room = new Room(null,JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(op),r);
      assert.deepEqual(room.snapshot(),journal);
      return r;
    },
  };
  for (const id of [...(kind === "two-lists" ? ["a", "b"] : ["b"]), ...(options.third ? ["c"] : [])]) {
    let h = auth.header("seed");
    auth.accept({
      ...h,
      intent: planListConversion(
        auth.state,
        previewListConversion(auth.state, parent, "l" + id, {
          items: ["i" + id],
        }),
        h,
      ).intent,
    });
    h = auth.header("language");
    auth.accept({
      ...h,
      intent: planCodeLanguage(auth.state, id, id === "a" ? "python" : "sql", h)
        .intent,
    });
    h = auth.header("body");
    auth.accept({
      ...h,
      intent: planConversion(
        auth.state,
        previewConversion(auth.state, parent, [id], "paragraph"),
        h,
      ).intent,
    });
  }
  return auth;
}
const view = (auth) => {
  const v = documentView(auth.state);
  return v.node(auth.parent).children.map((id) => {
    const n = v.node(id);
    return [
      n.type,
      ["code", "paragraph"].includes(n.type)
        ? v
            .text(id)
            .map((x) => x.char)
            .join("")
        : id,
      ...(n.type === "code" ? [codeLanguageState(n).language] : []),
    ];
  });
};
const conversion = (a, actor = "merge") => {
  const h = a.header(actor),
    v = documentView(a.state);
  return {
    ...h,
    intent: planConversion(
      a.state,
      previewConversion(
        a.state,
        a.parent,
        v.node(a.parent).children.flatMap((id) => v.group(id).blocks),
        "code",
      ),
      h,
    ).intent,
  };
};
const remove = (a, actor = "delete") => {
  const v = documentView(a.state),
    h = a.header(actor),
    p = {
      block: v.node(a.parent).children[0],
      offset: v.length(v.node(a.parent).children[0]),
    };
  if (v.node(p.block).type === "code")
    p.offset = v.text(p.block).findIndex((x) => x.boundary && x.right === "b");
  return {
    ...h,
    intent: planDelete(a.state, captureRange(a.state, p, p), "forward", h)
      .intent,
  };
};
const undo = (a, op) =>
  a.accept({ ...a.header(op.actor), intent: { kind: "undo", target: op.id } });
const anchorCheck = (a, anchor, ids) => {
  const r = resolveAnchor(a.state, anchor);
  assert.equal(r.status, "exact");
  assert.deepEqual(
    r.segments.filter((x) => ids.includes(x.id)).map((x) => x.id),
    ids,
  );
};

export { fixture, view, conversion, remove, undo, anchorCheck };
