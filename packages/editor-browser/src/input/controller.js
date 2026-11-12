// SPDX-License-Identifier: MPL-2.0
import { SLICE_MIME, validateRichSlice } from "@cwhy/jade-core/rich-slice";
import { copyRange } from "@cwhy/jade-core/commands";
import { TypingStyle } from "./typing-style.js";
import {
  GRID_MIME,
  validateGridFragment,
  gridPlainText,
  gridHTML,
  gridFromText,
} from "@cwhy/jade-core/grid-fragment";
import {
  captureCellRange,
  resolveCellRange,
  leaveTableSelection,
} from "@cwhy/jade-core/table-selection";
import { clearSpecialSelection } from "../selection/special.js";
import {
  decodeHTML,
  clipboardEnvelope,
  encodeClipboardHTML,
  MAX_CLIPBOARD_PAYLOAD,
} from "./clipboard.js";
import { captureDOMRange, installDOMRange } from "../selection/base.js";
import {
  captureRange,
  planReplace,
  insertionMarks,
  ReviewRequired,
} from "@cwhy/jade-core/selection";
import {
  plainFragment,
  plainText,
  htmlText,
  validateFragment,
  MIME,
} from "@cwhy/jade-core/fragment";
import { resolveGap } from "@cwhy/jade-core/model";
import {
  planDelete,
  planEnter,
  planCodeIndent,
} from "@cwhy/jade-core/prose-commands";
import { selectionStructure } from "@cwhy/jade-core/selection-structure";

// Isolated paragraph selection controller. The owner supplies rendering and
// synchronization, skips leased DOM while isComposing(), and persists recovery
// returned by dispose(). This module does not own durable session storage.
// Optional command planners share (state, range, operation[, options]) -> plan.
// They never publish or mutate DOM. This controller alone owns composition,
// selection history, client.prepare, commit and rendering. Omitted planners
// retain the existing prose/clipboard behavior; list indentation is opt-in.
export function bindSelectionController({
  root,
  client,
  commit,
  render,
  notice,
  commands = {},
  onSelectionChange = () => {},
  writeClipboard = null,
  onLinkReview = null,
  onCellPasteReview = null,
  onTableDeleteReview = null,
  domSelection = { captureDOMRange, installDOMRange },
}) {
  const planners = {
    replace: planReplace,
    enter: planEnter,
    delete: planDelete,
    codeIndent: planCodeIndent,
    ...commands,
  };
  for (const name of Object.keys(commands)) {
    if (
      ![
        "richInsert",
        "insertBlock",
        "previewCut",
        "cut",
        "linkContext",
        "checkLinkTarget",
        "link",
        "validateLinkURL",
        "textFormatState",
        "textFormat",
        "cellTextFormatState",
        "cellTextFormat",
        "previewCellStyle",
        "cellStyle",
        "headerRow",
        "previewDistributeColumns",
        "distributeColumns",
        "replace",
        "enter",
        "delete",
        "codeIndent",
        "listIndent",
        "navigateCell",
        "insertColumn",
        "insertRow",
        "boundaryParagraph",
        "clearCells",
        "pasteCells",
        "copyCells",
        "previewCellPaste",
        "previewTableDelete",
        "tableDelete",
        "previewRowResize",
        "resizeRow",
        "previewColumnResize",
        "resizeColumn",
        "previewTableMove",
        "tableMove",
      ].includes(name) ||
      typeof commands[name] !== "function"
    )
      throw new TypeError("Invalid editor command: " + name);
  }
  const capture = (state) => domSelection.captureDOMRange(state, root);
  const install = (state, range) => {
    domSelection.installDOMRange(state, root, range);
    onSelectionChange();
  };
  const typingStyle = new TypingStyle();
  let composing = null;
  let recovery = null;
  let pendingPaste = null;
  let pendingDelete = null;
  let plainPaste = false;
  let pendingCut = null,
    disposed = false;
  const cancelCut = () => {
    if (pendingCut) pendingCut.cancelled = true;
  };
  async function cutToClipboard(event) {
    event.preventDefault();
    if (pendingCut) {
      notice(
        "Clipboard write is still pending; source kept. Try Cut again after it finishes.",
      );
      return;
    }
    let job;
    try {
      if (composing)
        throw new ReviewRequired("Finish composition before cutting");
      if (!writeClipboard || !planners.previewCut || !planners.cut)
        throw new ReviewRequired("Cut is unavailable on this surface");
      const c = client(),
        preview = planners.previewCut(c.state, capture(c.state));
      if (!preview) return;
      job = { client: c, preview, cancelled: false };
      pendingCut = job;
      const cells = preview.kind === "cells",
        fragment = preview.fragment;
      notice("Copying selection…");
      const written = await writeClipboard({
        mime: cells ? GRID_MIME : MIME,
        fragment,
        plain: cells ? gridPlainText(fragment) : plainText(fragment),
        html: cells ? gridHTML(fragment) : htmlText(fragment),
      });
      if (disposed) return;
      if (written !== true)
        throw new ReviewRequired("Clipboard write did not complete");
      if (job.cancelled || composing || client() !== c) {
        notice(
          "Copied; editing changed while writing, so Cut was not applied.",
        );
        return;
      }
      execute(
        (state, r, op) => planners.cut(state, preview, op),
        preview.range,
        cells ? "cells" : null,
      );
      notice("Cut; source removal can be undone");
    } catch (error) {
      if (!disposed) notice("Cut not applied: " + error.message);
    } finally {
      if (pendingCut === job) pendingCut = null;
    }
  }

  function keepDraft(text, reason) {
    recovery = { text, reason };
    return recovery;
  }

  const selectionHistory = new Map();
  let historyOwner;
  const compact = (range) =>
    range.kind
      ? structuredClone(range)
      : { epoch: range.epoch, anchor: range.anchor, focus: range.focus };
  function historyFor(c, prune = false) {
    if (historyOwner !== c) {
      selectionHistory.clear();
      historyOwner = c;
    }
    if (!prune) return;
    // A pending inverse can be rejected. Keep its source caret record until
    // that decision, so restoring the history entry also restores selection.
    const retained = new Set([
      ...c.undoStack.flatMap((g) => g.ids),
      ...c.redoStack,
      ...c.pending.flatMap((op) =>
        op.intent.kind === "undo"
          ? op.intent.targets || [op.intent.target]
          : [],
      ),
    ]);
    for (const id of selectionHistory.keys())
      if (!retained.has(id)) selectionHistory.delete(id);
  }
  function execute(
    planner,
    range = capture(client().state),
    allowedKind = null,
  ) {
    const c = client();
    historyFor(c);
    const keepTyping = typingStyle.active(c.state, range, c);
    const op = {
      id: `${c.actor}:${c.stream}:${c.seq + 1}`,
      actor: c.actor,
      epoch: c.state.epoch,
    };
    if (range?.kind && range.kind !== allowedKind)
      throw new ReviewRequired(
        "Choose a text caret first; cell-range editing is not qualified yet",
      );
    const plan = planner(c.state, range, op);
    if (!plan.intent) {
      if (plan.selection) {
        root.focus();
        install(c.state, plan.selection);
      }
      notice(plan.notice || "");
      return;
    }
    const abandonedRedo = [...c.redoStack];
    c.prepare(plan.intent);
    for (const id of abandonedRedo) selectionHistory.delete(id);
    const point = plan.selection ? null : resolveGap(c.state, plan.after);
    const after = compact(
      plan.selection || captureRange(c.state, point, point),
    );
    selectionHistory.set(op.id, { before: compact(range), after });
    if (keepTyping)
      typingStyle.advance({ ...after, collapsed: !plan.selection }, c);
    commit();
    render();
    root.focus();
    install(c.state, after);
    notice(plan.notice || "");
  }
  function openLink(bookmark = null, edit = true) {
    if (composing)
      throw new ReviewRequired("Finish composition before editing links");
    const c = client();
    if (bookmark && bookmark.client !== c)
      throw new ReviewRequired("Editing session changed");
    if (!planners.linkContext || !onLinkReview)
      throw new ReviewRequired("Link controls are unavailable");
    const context = planners.linkContext(
        c.state,
        bookmark?.range || capture(c.state),
      ),
      lease = { client: c, context, edit };
    root.focus();
    install(c.state, context.range);
    onLinkReview(lease);
    return lease;
  }
  function formatText(property, value, range = capture(client().state)) {
    if (composing)
      throw new ReviewRequired("Finish composition before formatting text");
    if (range?.kind || range.collapsed || !planners.textFormat)
      throw new ReviewRequired("Select text before formatting");
    execute(
      (state, r, op) => planners.textFormat(state, r, op, { property, value }),
      range,
    );
  }
  function formatCells(property, value, range = capture(client().state)) {
    if (composing)
      throw new ReviewRequired("Finish composition before formatting cells");
    if (range?.kind !== "cells" || !planners.cellTextFormat)
      throw new ReviewRequired(
        "Select cells before using cell text formatting",
      );
    execute(
      (state, r, op) =>
        planners.cellTextFormat(state, r, op, { property, value }),
      range,
      "cells",
    );
  }
  function insertBoundary(text, range) {
    if (!planners.boundaryParagraph)
      throw new ReviewRequired(
        "Boundary typing is not qualified on this surface",
      );
    execute(
      (state, r, op) => planners.boundaryParagraph(state, r, op, { text }),
      range,
      "boundary",
    );
    revealSelection();
  }
  function replace(
    fragment,
    range = capture(client().state),
    strict = true,
    inheritedMarks,
    plainInput = false,
  ) {
    if (range.kind === "boundary") {
      fragment = validateFragment(fragment);
      if (
        fragment.blocks.length !== 1 ||
        fragment.blocks[0].type !== "paragraph" ||
        fragment.blocks[0].content.some((run) => run.marks?.length)
      )
        throw new ReviewRequired(
          "Rich boundary paste needs a structural clipboard command",
        );
      return insertBoundary(plainText(fragment), range);
    }
    execute(
      (state, r, op) =>
        planners.replace(state, r, fragment, op, {
          strict,
          inheritedMarks,
          plainText: plainInput,
        }),
      range,
    );
  }
  function revealSelection() {
    const selection = root.ownerDocument.getSelection(),
      node = selection?.focusNode;
    const special = root.querySelector(
      "[data-table-boundary],[data-selected-cell]",
    );
    const element =
      special ||
      (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
        "[data-block]",
      );
    if (element && root.contains(element))
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function navigateCell(direction, range) {
    if (composing)
      throw new ReviewRequired(
        "Finish composition before moving to another cell",
      );
    if (!planners.navigateCell)
      throw new ReviewRequired(
        "Cell navigation is not qualified on this surface",
      );
    range = range || capture(client().state);
    if (range.kind) {
      root.focus();
      install(client().state, leaveTableSelection(client().state, range));
      notice("");
    } else
      execute(
        (state, r, op) => planners.navigateCell(state, r, op, { direction }),
        range,
      );
    revealSelection();
  }
  function selectCell(cell, extend = false) {
    if (composing)
      throw new ReviewRequired("Finish composition before selecting cells");
    const state = client().state,
      structure = selectionStructure(state),
      row = structure.parent(cell),
      table = row && structure.parent(row.id);
    if (table?.type !== "table")
      throw new ReviewRequired("Cell selection target is unavailable");
    let prior;
    try {
      prior = capture(state);
    } catch {}
    const anchor =
      extend && prior?.kind === "cells" && prior.table === table.id
        ? prior.anchor
        : cell;
    const range = captureCellRange(state, table.id, anchor, cell);
    root.focus();
    install(state, range);
    notice(`Selected ${range.cells.flat().length} cells`);
  }
  function clearCells(range = capture(client().state)) {
    if (composing)
      throw new ReviewRequired("Finish composition before clearing cells");
    if (!planners.clearCells || range.kind !== "cells")
      throw new ReviewRequired("Select a cell rectangle before clearing");
    execute(planners.clearCells, range, "cells");
  }
  function beginCellPaste(input, range, formatNotice = "") {
    if (
      !planners.pasteCells ||
      !planners.copyCells ||
      !planners.previewCellPaste ||
      !onCellPasteReview
    )
      throw new ReviewRequired(
        "Cell paste preview is unavailable on this surface",
      );
    const c = client(),
      fragment = validateGridFragment(input);
    const pending = {
      client: c,
      range: structuredClone(range),
      fragment,
      formatNotice,
      preview: null,
      error: "",
    };
    pendingPaste = pending;
    function current() {
      if (pendingPaste !== pending || client() !== c)
        throw new ReviewRequired("Paste review session changed");
      if (composing)
        throw new ReviewRequired("Finish composition before pasting");
    }
    function display() {
      if (pendingPaste !== pending) return;
      const options = ["match", "fill", "start", "expand"].map((mode) => {
        try {
          planners.previewCellPaste(c.state, pending.range, fragment, mode);
          return { mode, available: true };
        } catch (error) {
          return { mode, available: false, reason: error.message };
        }
      });
      onCellPasteReview({
        fragment,
        formatNotice,
        error: pending.error,
        preview: pending.preview,
        options,
        before: pending.preview
          ? pending.preview.before ||
            planners.copyCells(c.state, pending.preview.range)
          : null,
        choose(mode) {
          try {
            current();
            pending.preview = planners.previewCellPaste(
              c.state,
              pending.range,
              fragment,
              mode,
            );
            pending.error = "";
          } catch (error) {
            pending.preview = null;
            pending.error = error.message;
          }
          display();
        },
        confirm() {
          try {
            current();
            if (!pending.preview)
              throw new ReviewRequired("Choose the destination mapping first");
            execute(
              (state, r, op) =>
                planners.pasteCells(state, r, op, { preview: pending.preview }),
              pending.range,
              "cells",
            );
            pendingPaste = null;
            onCellPasteReview(null);
            return true;
          } catch (error) {
            pending.error = error.message;
            pending.preview = null;
            display();
            return false;
          }
        },
        cancel() {
          if (pendingPaste !== pending) return;
          pendingPaste = null;
          onCellPasteReview(null);
          root.focus();
          try {
            install(c.state, pending.range);
          } catch (error) {
            notice(error.message);
          }
        },
      });
    }
    try {
      pending.preview = planners.previewCellPaste(
        c.state,
        range,
        fragment,
        "match",
      );
    } catch (error) {
      pending.error = error.message;
    }
    display();
  }
  function beginTableDelete(axis) {
    if (composing)
      throw new ReviewRequired(
        "Finish composition before deleting table structure",
      );
    if (
      !planners.tableDelete ||
      !planners.previewTableDelete ||
      !onTableDeleteReview
    )
      throw new ReviewRequired("Table deletion review is unavailable");
    const c = client(),
      range = capture(c.state),
      preview = planners.previewTableDelete(c.state, range, axis);
    const perform = (p) => {
      execute(
        (state, r, op) => planners.tableDelete(state, r, op, { preview: p }),
        range,
        range.kind === "cells" ? "cells" : null,
      );
      revealSelection();
    };
    if (preview.empty) {
      perform(preview);
      return;
    }
    const pending = {
      client: c,
      range,
      axis,
      preview,
      error: "",
      stale: false,
    };
    pendingDelete = pending;
    function current() {
      if (pendingDelete !== pending || client() !== c)
        throw new ReviewRequired("Deletion review session changed");
      if (composing)
        throw new ReviewRequired(
          "Finish composition before deleting table structure",
        );
    }
    function display() {
      onTableDeleteReview({
        preview: pending.preview,
        error: pending.error,
        stale: pending.stale,
        refresh() {
          try {
            current();
            pending.preview = planners.previewTableDelete(c.state, range, axis);
            pending.error = "";
            pending.stale = false;
          } catch (error) {
            pending.error = error.message;
            pending.stale = true;
          }
          display();
        },
        confirm() {
          try {
            current();
            if (pending.stale)
              throw new ReviewRequired("Refresh deletion review first");
            perform(pending.preview);
            pendingDelete = null;
            onTableDeleteReview(null);
            return true;
          } catch (error) {
            pending.error = error.message;
            pending.stale = true;
            display();
            return false;
          }
        },
        cancel() {
          if (pendingDelete !== pending) return;
          pendingDelete = null;
          onTableDeleteReview(null);
          root.focus();
          try {
            install(c.state, range);
          } catch (error) {
            notice(error.message);
          }
        },
      });
    }
    display();
  }
  function history(redo) {
    typingStyle.clear();
    const c = client();
    historyFor(c);
    const ids = redo ? [c.redoStack.at(-1)] : c.undoStack.at(-1)?.ids;
    const first = ids && selectionHistory.get(ids[0]),
      last = ids && selectionHistory.get(ids.at(-1));
    const changed = redo ? c.redo() : c.undo();
    if (changed) {
      const id = `${c.actor}:${c.stream}:${c.seq}`;
      if (first && last)
        selectionHistory.set(id, { before: last.after, after: first.before });
      historyFor(c, true);
      commit();
      render();
      if (first) {
        root.focus();
        install(c.state, first.before);
      }
    }
    notice("");
  }

  const safely = (fn) => (event) => {
    try {
      fn(event);
    } catch (error) {
      notice(error.message);
    }
  };

  function finishComposition(event) {
    const saved = composing;
    if (!saved) return;
    // Chrome's final input and compositionend belong to one native event turn.
    // Keep the lease until that turn's reconciliation boundary.
    queueMicrotask(() => {
      if (composing !== saved) return;
      composing = null;
      try {
        if (client() !== saved.client)
          throw new ReviewRequired("Editing session changed");
        if (saved.blocked) {
          if (event.data || saved.draft)
            keepDraft(
              event.data || saved.draft,
              "Composition at a structural selection is not qualified yet",
            );
          render();
          root.focus();
          install(client().state, saved.range);
          notice("Composition kept locally; choose a text caret before typing");
          return;
        }
        if (event.data)
          replace(plainFragment(event.data), saved.range, false, saved.marks);
        else {
          render();
          if (saved.range.kind) {
            root.focus();
            install(client().state, saved.range);
          }
          notice("");
        }
      } catch (error) {
        keepDraft(event.data || saved.draft, error.message);
        render();
        notice("Composition kept for recovery: " + error.message);
      }
    });
  }

  const handlers = {
    keyup: (event) => {
      if (event.key.toLowerCase() === "v") plainPaste = false;
    },
    click: safely((event) => {
      const a = event.target.closest?.("a[href]");
      if (!a || !root.contains(a) || !planners.linkContext) return;
      event.preventDefault();
      const href = planners.validateLinkURL(a.getAttribute("href"));
      if (event.metaKey || event.ctrlKey) {
        root.ownerDocument.defaultView.open(
          href,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }
      openLink(null, false);
    }),
    mousedown: safely((event) => {
      const handle = event.target.closest?.("[data-cell-handle]");
      if (handle && root.contains(handle)) {
        event.preventDefault();
        selectCell(handle.dataset.cellHandle, event.shiftKey);
      } else clearSpecialSelection(root);
    }),
    compositionstart: safely(() => {
      cancelCut();
      if (composing) throw new ReviewRequired("Composition already active");
      const range = capture(client().state);
      composing = {
        client: client(),
        range,
        marks: range.kind
          ? []
          : typingStyle.marks(client().state, range, client()),
        blocked:
          !!range.kind &&
          !(range.kind === "boundary" && planners.boundaryParagraph),
        draft: "",
      };
    }),
    compositionupdate: (event) => {
      if (composing) composing.draft = event.data;
    },
    compositionend: finishComposition,
    keydown: safely((event) => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v")
        plainPaste = event.shiftKey;
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        const range = capture(client().state);
        if (
          !range.kind &&
          range.slices.every((s) => s.type === "paragraph") &&
          planners.linkContext
        ) {
          event.preventDefault();
          openLink();
          return;
        }
      }
      const handle = event.target.closest?.("[data-cell-handle]");
      if (handle && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        selectCell(handle.dataset.cellHandle, event.shiftKey);
        return;
      }
      if (["Backspace", "Delete"].includes(event.key)) {
        const range = capture(client().state);
        if (range.kind === "cells") {
          event.preventDefault();
          clearCells(range);
          return;
        }
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ((!event.shiftKey &&
          ["b", "i", "u"].includes(event.key.toLowerCase())) ||
          (event.shiftKey && event.key.toLowerCase() === "x"))
      ) {
        const range = capture(client().state),
          property = { b: "strong", i: "em", u: "underline", x: "strike" }[
            event.key.toLowerCase()
          ];
        if (range.kind === "cells") {
          event.preventDefault();
          formatCells(property, undefined, range);
          return;
        }
        if (!range.kind && !range.collapsed && planners.textFormat) {
          event.preventDefault();
          formatText(property, undefined, range);
          return;
        }
        if (!range.kind && range.collapsed && planners.textFormat) {
          event.preventDefault();
          if (range.slices[0].type === "code") {
            notice(
              "Code text skipped; use whole-cell formatting for code styles",
            );
            return;
          }
          const on = typingStyle.toggle(
            client().state,
            range,
            client(),
            property,
          );
          notice(
            `${{ strong: "Bold", em: "Italic", underline: "Underline", strike: "Strikethrough" }[property]} ${on ? "on" : "off"} for new text`,
          );
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        history(event.shiftKey);
      } else if (
        [
          "Escape",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Tab",
        ].includes(event.key)
      ) {
        const state = client().state,
          range = capture(state);
        if (range.kind) {
          event.preventDefault();
          if (
            event.key === "Escape" ||
            (event.key === "Tab" && !event.shiftKey) ||
            event.key === "ArrowDown" ||
            event.key === "ArrowRight"
          ) {
            root.focus();
            install(state, leaveTableSelection(state, range));
            revealSelection();
            notice("");
          }
          return;
        }
        if (
          event.key !== "Tab" ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
          return;
        const c = client(),
          at = resolveGap(c.state, range.start);
        const structure = selectionStructure(c.state);
        let node = c.state.nodes[at.block];
        if (node.type === "code") {
          event.preventDefault();
          execute(
            (state, r, op) =>
              planners.codeIndent(state, r, op, { outdent: event.shiftKey }),
            range,
          );
        } else {
          while (node) {
            if (node.type === "list_item" && planners.listIndent) {
              event.preventDefault();
              execute(
                (state, r, op) =>
                  planners.listIndent(state, r, op, {
                    outdent: event.shiftKey,
                  }),
                range,
              );
              return;
            }
            if (node.type === "cell" && planners.navigateCell) {
              event.preventDefault();
              navigateCell(event.shiftKey ? -1 : 1, range);
              return;
            }
            if (["list_item", "cell"].includes(node.type)) {
              event.preventDefault();
              throw new ReviewRequired(
                "Navigation is not qualified on this surface",
              );
            }
            node = structure.parent(node.id);
          }
        }
      }
    }),
    beforeinput: safely((event) => {
      cancelCut();
      if (composing || event.isComposing || !event.cancelable) return;
      event.preventDefault();
      if (!["historyUndo", "historyRedo"].includes(event.inputType)) {
        const range = capture(client().state);
        if (
          range.kind === "boundary" &&
          ["insertText", "insertParagraph", "insertLineBreak"].includes(
            event.inputType,
          )
        ) {
          if (event.inputType === "insertText" && !event.data) return;
          insertBoundary(
            event.inputType === "insertText"
              ? event.data
              : event.inputType === "insertLineBreak"
                ? "\n"
                : "",
            range,
          );
          return;
        }
        if (
          range.kind === "cells" &&
          ["deleteContentBackward", "deleteContentForward"].includes(
            event.inputType,
          )
        ) {
          clearCells(range);
          return;
        }
        if (range.kind)
          throw new ReviewRequired(
            "Choose a text caret first; this structural selection input is not qualified yet",
          );
      }
      if (event.inputType === "insertText") {
        const range = capture(client().state);
        replace(
          plainFragment(event.data || ""),
          range,
          true,
          typingStyle.marks(client().state, range, client()),
        );
      } else if (
        ["insertParagraph", "insertLineBreak"].includes(event.inputType)
      ) {
        const c = client(),
          range = capture(c.state),
          style = typingStyle.marks(c.state, range, c);
        if (range.collapsed) typingStyle.adopt(range, c, style);
        execute(
          (state, r, op) =>
            planners.enter(state, r, op, {
              soft: event.inputType === "insertLineBreak",
              inheritedMarks: style,
            }),
          range,
        );
      } else if (
        ["deleteContentBackward", "deleteContentForward"].includes(
          event.inputType,
        )
      ) {
        execute((state, r, op) =>
          planners.delete(
            state,
            r,
            event.inputType === "deleteContentBackward"
              ? "backward"
              : "forward",
            op,
          ),
        );
      } else if (["historyUndo", "historyRedo"].includes(event.inputType)) {
        history(event.inputType === "historyRedo");
      } else if (event.inputType !== "insertFromPaste") {
        throw new ReviewRequired("Input command is outside this experiment");
      }
    }),
    paste: safely((event) => {
      cancelCut();
      event.preventDefault();
      if (composing)
        throw new ReviewRequired("Finish composition before pasting");
      const c = client(),
        range = capture(c.state),
        plainOnly = plainPaste,
        localMarks = range.kind ? [] : typingStyle.marks(c.state, range, c);
      plainPaste = false;
      typingStyle.clear();
      const data = event.clipboardData;
      if (!data) throw new ReviewRequired("Clipboard unavailable");
      const html = plainOnly ? "" : data.getData("text/html"),
        envelope =
          plainOnly ||
          data.getData(MIME) ||
          data.getData(GRID_MIME) ||
          data.getData(SLICE_MIME)
            ? null
            : clipboardEnvelope(html, root.ownerDocument);
      const rich = plainOnly
        ? ""
        : data.getData(SLICE_MIME) ||
          (envelope?.type === SLICE_MIME ? envelope.payload : "");
      if (rich) {
        if (rich.length > MAX_CLIPBOARD_PAYLOAD)
          throw new ReviewRequired("Clipboard slice is too large");
        const slice = validateRichSlice(JSON.parse(rich));
        if (range.kind === "cells") {
          beginCellPaste({ version: 1, rows: [[slice.blocks]] }, range);
          return;
        }
        if (!planners.richInsert)
          throw new ReviewRequired(
            "Rich caret paste is unavailable on this surface; destination unchanged",
          );
        execute(
          (state, r, op) => planners.richInsert(state, r, slice, op),
          range,
        );
        return;
      }
      if (range.kind === "cells") {
        const grid = plainOnly
          ? ""
          : data.getData(GRID_MIME) ||
            (envelope?.type === GRID_MIME ? envelope.payload : "");
        if (grid.length > MAX_CLIPBOARD_PAYLOAD)
          throw new ReviewRequired("Clipboard grid is too large");
        beginCellPaste(
          grid ? JSON.parse(grid) : gridFromText(data.getData("text/plain")),
          range,
          !grid && html
            ? "Paste text only: external formatting and media are not supported in this preview."
            : "",
        );
        return;
      }
      if (range.kind)
        throw new ReviewRequired(
          "Structural selection paste is not qualified yet",
        );
      const internal = plainOnly
        ? ""
        : data.getData(MIME) ||
          (envelope?.type === MIME ? envelope.payload : "");
      if (internal.length > MAX_CLIPBOARD_PAYLOAD)
        throw new ReviewRequired("Clipboard payload is too large");
      if (
        !plainOnly &&
        !internal &&
        planners.linkContext &&
        range.slices.every((s) => s.type === "paragraph")
      ) {
        let href;
        try {
          href = planners.validateLinkURL(data.getData("text/plain"));
        } catch {}
        if (href) {
          const context = planners.linkContext(client().state, range);
          execute(
            (state, r, op) =>
              planners.link(state, context, op, {
                href,
                label: range.collapsed ? href : context.label,
              }),
            range,
          );
          return;
        }
      }
      let fragment;
      if (internal) fragment = validateFragment(JSON.parse(internal));
      else if (html) {
        const decoded = decodeHTML(html, root.ownerDocument);
        if (decoded.notices.length)
          throw new ReviewRequired(decoded.notices.join("; "));
        fragment = decoded.fragment;
      } else fragment = plainFragment(data.getData("text/plain"));
      const inherited = !internal && !html ? localMarks : undefined;
      // Preserve local typing intent through a successful plain paste, including
      // an explicitly toggled style that has no preceding styled character yet.
      if (inherited && range.collapsed) typingStyle.adopt(range, c, inherited);
      replace(fragment, range, true, inherited, !internal && !html);
    }),
    copy: safely((event) => {
      cancelCut();
      event.preventDefault();
      const range = capture(client().state);
      if (range.kind === "cells") {
        if (composing)
          throw new ReviewRequired("Finish composition before copying cells");
        if (!planners.copyCells || !event.clipboardData)
          throw new ReviewRequired("Cell clipboard unavailable");
        const fragment = planners.copyCells(client().state, range);
        event.clipboardData.setData(GRID_MIME, JSON.stringify(fragment));
        event.clipboardData.setData("text/plain", gridPlainText(fragment));
        event.clipboardData.setData("text/html", gridHTML(fragment));
        notice("Cells copied");
        return;
      }
      if (range.kind) throw new ReviewRequired("Choose text or cells to copy");
      if (range.collapsed) return;
      const copied = copyRange(client().state, range);
      if (!event.clipboardData)
        throw new ReviewRequired("Clipboard unavailable");
      const encoded = encodeClipboardHTML(
        copied.mime,
        JSON.stringify(copied.fragment),
        copied.html,
      );
      event.clipboardData.setData(copied.mime, JSON.stringify(copied.fragment));
      event.clipboardData.setData("text/plain", copied.plain);
      event.clipboardData.setData("text/html", encoded);
    }),
    cut: (event) => {
      void cutToClipboard(event);
    },
  };
  const selectionChanged = () => {
    if (composing) return;
    try {
      typingStyle.active(client().state, capture(client().state), client());
    } catch {
      typingStyle.clear();
    }
  };
  root.ownerDocument.addEventListener("selectionchange", selectionChanged);
  root.ownerDocument.addEventListener("keydown", cancelCut, true);
  root.ownerDocument.addEventListener("pointerdown", cancelCut, true);
  for (const [name, handler] of Object.entries(handlers))
    root.addEventListener(name, handler);
  return {
    captureInsertion(){
      try{const range=capture(client().state);return !composing&&!range.kind&&range.collapsed?{client:client(),range}:null;}catch{return null;}
    },
    insertBlock(options,bookmark){
      try{if(composing||!bookmark||bookmark.client!==client()||!planners.insertBlock)throw new ReviewRequired("Place a caret in the document before inserting");
        execute((state,range,op)=>planners.insertBlock(state,range,op,options),bookmark.range);return true;
      }catch(error){notice(error.message);return false;}
    },
    openLink(bookmark) {
      try {
        return openLink(bookmark, true);
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    checkLink(lease) {
      if (lease.client !== client())
        throw new ReviewRequired("Editing session changed");
      planners.checkLinkTarget(client().state, lease.context);
    },
    commitLink(lease, options) {
      try {
        if (composing)
          throw new ReviewRequired("Finish composition before editing links");
        this.checkLink(lease);
        typingStyle.clear();
        execute(
          (state, r, op) => planners.link(state, lease.context, op, options),
          lease.context.range,
        );
        return { ok: true };
      } catch (error) {
        notice(error.message);
        return { ok: false, error: error.message };
      }
    },
    restoreLink(lease) {
      try {
        this.checkLink(lease);
        root.focus();
        install(client().state, lease.context.range);
        return true;
      } catch {
        return false;
      }
    },
    textFormatState(property, range) {
      try {
        if (composing) return null;
        range = range || capture(client().state);
        if (range.kind || range.collapsed) return null;
        return (
          planners.textFormatState?.(client().state, range, property) || null
        );
      } catch {
        return null;
      }
    },
    textDOMRange(bookmark) {
      try {
        if (composing || bookmark.client !== client()) return null;
        return (
          domSelection.rangeToDOM?.(client().state, root, bookmark.range) ||
          null
        );
      } catch {
        return null;
      }
    },
    linkDOMRange(lease) {
      this.checkLink(lease);
      return (
        domSelection.rangeToDOM?.(client().state, root, lease.context.range) ||
        null
      );
    },
    restoreFormatting(bookmark) {
      try {
        if (bookmark.client !== client())
          throw new ReviewRequired("Editing session changed");
        root.focus();
        install(client().state, bookmark.range);
        return true;
      } catch {
        return false;
      }
    },
    captureFormatting(scope = "text") {
      try {
        const r = capture(client().state),
          eligible =
            scope === "cells" ? r.kind === "cells" : !r.kind && !r.collapsed;
        return !composing && eligible ? { client: client(), range: r } : null;
      } catch {
        return null;
      }
    },
    cellDOMRanges(bookmark) {
      try {
        if (composing || bookmark.client !== client()) return [];
        const range = resolveCellRange(client().state, bookmark.range);
        return range.cells.flat().map((id) => {
          const el = root.querySelector(
            `[data-node="${root.ownerDocument.defaultView.CSS.escape(id)}"]`,
          );
          if (!el) throw Error("Selection is not rendered");
          const r = root.ownerDocument.createRange();
          r.selectNode(el);
          return r;
        });
      } catch {
        return [];
      }
    },
    formatText(property, value, bookmark) {
      try {
        if (bookmark && bookmark.client !== client())
          throw new ReviewRequired("Editing session changed");
        formatText(property, value, bookmark?.range);
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    cellTextFormatState(property, range) {
      try {
        if (composing) return null;
        return (
          planners.cellTextFormatState?.(
            client().state,
            range || capture(client().state),
            property,
          ) || null
        );
      } catch {
        return null;
      }
    },
    formatCells(property, value, bookmark) {
      try {
        if (bookmark && bookmark.client !== client())
          throw new ReviewRequired("Editing session changed");
        formatCells(property, value, bookmark?.range);
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    beginTableControls(cell = null) {
      try {
        if (composing)
          throw new ReviewRequired(
            "Finish composition before using table controls",
          );
        const c = client(),
          state = c.state,
          structure = selectionStructure(state);
        let range;
        try {
          range = capture(state);
        } catch {}
        if (!cell) {
          if (range?.kind === "cells") cell = range.focus;
          else if (range && !range.kind) {
            let n = state.nodes[resolveGap(state, range.end).block];
            while (n && n.type !== "cell") n = structure.parent(n.id);
            cell = n?.id;
          }
        }
        const row = cell && structure.parent(cell),
          table = row && structure.parent(row.id);
        if (table?.type !== "table")
          throw new ReviewRequired("Place the caret or selection in a table");
        const first = state.nodes[table.children[0]].children[0],
          last = state.nodes[table.children.at(-1)].children.at(-1),
          grid = captureCellRange(state, table.id, first, last);
        try {
          if (
            !range ||
            planners.previewTableMove(state, range, "rows").table !== table.id
          )
            range = null;
        } catch {
          range = null;
        }
        range = range || captureCellRange(state, table.id, cell);
        let focus = cell;
        if (range.kind === "cells") focus = range.focus;
        else {
          let n = state.nodes[resolveGap(state, range.end).block];
          while (n && n.type !== "cell") n = structure.parent(n.id);
          focus = n?.id || cell;
        }
        return { client: c, cell, focus, table: table.id, grid, range };
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    checkTableControls(lease) {
      if (composing)
        throw new ReviewRequired(
          "Finish composition before using table controls",
        );
      const c = client();
      if (c !== lease.client)
        throw new ReviewRequired("Table controls session changed");
      try {
        const table = c.state.nodes[lease.table],
          rows = table.children,
          first = c.state.nodes[rows[0]].children[0],
          last = c.state.nodes[rows.at(-1)].children.at(-1),
          now = captureCellRange(c.state, lease.table, first, last);
        if (
          JSON.stringify(now.rows) !== JSON.stringify(lease.grid.rows) ||
          JSON.stringify(now.cells) !== JSON.stringify(lease.grid.cells)
        )
          throw Error("membership changed");
      } catch {
        throw new ReviewRequired(
          "Table structure changed; reopen the controls",
        );
      }
    },
    restoreTableControls(lease) {
      try {
        this.checkTableControls(lease);
        root.focus();
        install(client().state, lease.range);
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    selectTableAxis(lease, axis, extend = false) {
      try {
        this.checkTableControls(lease);
        const rows = lease.grid.cells,
          locate = (id) => {
            const row = rows.findIndex((r) => r.includes(id));
            return { row, col: rows[row].indexOf(id) };
          },
          target = locate(lease.cell),
          a =
            extend && lease.range.kind === "cells"
              ? locate(lease.range.anchor)
              : target;
        const first =
            axis === "columns"
              ? rows[0][a.col]
              : axis === "rows"
                ? rows[a.row][0]
                : rows[0][0],
          last =
            axis === "columns"
              ? rows.at(-1)[target.col]
              : axis === "rows"
                ? rows[target.row].at(-1)
                : rows.at(-1).at(-1);
        const range = captureCellRange(
          client().state,
          lease.table,
          first,
          last,
        );
        root.focus();
        install(client().state, range);
        notice(`Selected ${range.cells.flat().length} cells`);
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    insertTableBoundary(lease, axis, index) {
      try {
        this.checkTableControls(lease);
        const rows = lease.grid.cells,
          focusRow = rows.findIndex((row) => row.includes(lease.focus)),
          focusColumn = rows[focusRow].indexOf(lease.focus),
          count = axis === "rows" ? rows.length : rows[0].length;
        if (
          !["rows", "columns"].includes(axis) ||
          !Number.isInteger(index) ||
          index < 0 ||
          index > count
        )
          throw new ReviewRequired("Insertion boundary is unavailable");
        const cell =
            axis === "rows"
              ? rows[Math.min(index, count - 1)][focusColumn]
              : rows[focusRow][Math.min(index, count - 1)],
          target = captureCellRange(client().state, lease.table, cell);
        execute(
          (state, r, op) =>
            axis === "rows"
              ? planners.insertRow(state, target, op, {
                  side: index === count ? "below" : "above",
                })
              : planners.insertColumn(state, target, op, {
                  side: index === count ? "right" : "left",
                }),
          lease.range,
          lease.range.kind || null,
        );
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    tableControl(lease, action) {
      try {
        this.checkTableControls(lease);
        const rows = lease.grid.cells,
          selected =
            lease.range.kind === "cells"
              ? lease.range
              : captureCellRange(client().state, lease.table, lease.focus),
          top = rows.findIndex((row) => row.includes(selected.cells[0][0])),
          bottom = top + selected.cells.length,
          left = rows[top].indexOf(selected.cells[0][0]),
          right = left + selected.cells[0].length;
        const boundaries = {
          "insert-row-above": ["rows", top],
          "insert-row-below": ["rows", bottom],
          "insert-column-left": ["columns", left],
          "insert-column-right": ["columns", right],
        };
        if (boundaries[action])
          return this.insertTableBoundary(lease, ...boundaries[action]);
        if (action === "clear") {
          execute(
            (state, r, op) => planners.clearCells(state, selected, op),
            lease.range,
            lease.range.kind || null,
          );
          return true;
        }
        if (!this.restoreTableControls(lease)) return false;
        if (
          action === "delete-rows" ||
          action === "delete-columns" ||
          action === "delete-table"
        ) {
          beginTableDelete(action.slice(7));
          return true;
        }
        const moves = {
          "move-up": ["rows", -1],
          "move-down": ["rows", 1],
          "move-left": ["columns", -1],
          "move-right": ["columns", 1],
        };
        if (moves[action]) {
          this.moveTableBy(...moves[action]);
          return true;
        }
        if (action === "next" || action === "previous") {
          navigateCell(action === "next" ? 1 : -1);
          return true;
        }
        throw new ReviewRequired("Unsupported table control");
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    beginTableMove(cell, axis) {
      try {
        if (composing)
          throw new ReviewRequired(
            "Finish composition before moving table structure",
          );
        if (!planners.previewTableMove || !planners.tableMove)
          throw new ReviewRequired("Table moving is unavailable");
        const c = client(),
          structure = selectionStructure(c.state),
          row = structure.parent(cell),
          table = row && structure.parent(row.id);
        if (table?.type !== "table")
          throw new ReviewRequired("Move target is unavailable");
        const single = captureCellRange(c.state, table.id, cell),
          target = planners.previewTableMove(c.state, single, axis);
        let range = single,
          preview = target;
        try {
          const selected = capture(c.state),
            candidate = planners.previewTableMove(c.state, selected, axis);
          if (
            candidate.table === target.table &&
            candidate.targets.includes(target.targets[0])
          ) {
            range = selected;
            preview = candidate;
          }
        } catch {}
        return { client: c, cell, range, preview };
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    checkTableMove(lease) {
      if (composing)
        throw new ReviewRequired(
          "Finish composition before moving table structure",
        );
      const c = client();
      if (c !== lease.client) throw new ReviewRequired("Move session changed");
      const single = captureCellRange(c.state, lease.preview.table, lease.cell),
        now = planners.previewTableMove(c.state, single, lease.preview.axis);
      if (
        JSON.stringify(now.expected) !== JSON.stringify(lease.preview.expected)
      )
        throw new ReviewRequired("Table order changed; start moving again");
    },
    commitTableMove(lease, before) {
      try {
        this.checkTableMove(lease);
        execute(
          (state, r, op) =>
            planners.tableMove(state, r, op, {
              preview: lease.preview,
              before,
            }),
          lease.range,
          lease.range.kind || null,
        );
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    moveTableBy(axis, direction) {
      try {
        if (composing)
          throw new ReviewRequired(
            "Finish composition before moving table structure",
          );
        const c = client(),
          range = capture(c.state),
          preview = planners.previewTableMove(c.state, range, axis),
          order = preview.expected.order,
          start = order.indexOf(preview.targets[0]),
          end = start + preview.targets.length;
        if (
          (direction < 0 && start === 0) ||
          (direction > 0 && end === order.length)
        ) {
          notice("Already at the table edge");
          return;
        }
        const before =
          direction < 0 ? order[start - 1] : (order[end + 1] ?? null);
        execute(
          (state, r, op) =>
            planners.tableMove(state, r, op, { preview, before }),
          range,
          range.kind || null,
        );
      } catch (error) {
        notice(error.message);
      }
    },
    beginTablePresentation(control) {
      try {
        this.checkTableControls(control);
        const state = client().state,
          range =
            control.range.kind === "cells"
              ? control.range
              : captureCellRange(state, control.table, control.focus);
        return {
          control,
          preview: planners.previewCellStyle(state, range),
          distribution: planners.previewDistributeColumns(state, control.table),
          header: state.nodes[control.table].headerRow === true,
          values: range.cells
            .flat()
            .map((id) => ({
              id,
              background: state.nodes[id].background ?? null,
              verticalAlign: state.nodes[id].verticalAlign ?? null,
              textAlign: state.nodes[id].textAlign ?? null,
            })),
        };
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    commitTablePresentation(lease, action, patch) {
      try {
        if (!["style", "header", "distribute"].includes(action))
          throw new ReviewRequired("Unsupported table presentation action");
        this.checkTableControls(lease.control);
        const range = lease.control.range;
        execute(
          (state, r, op) =>
            action === "style"
              ? planners.cellStyle(state, r, op, {
                  preview: lease.preview,
                  patch,
                })
              : action === "header"
                ? planners.headerRow(state, r, op, {
                    table: lease.control.table,
                    value: !lease.header,
                  })
                : planners.distributeColumns(state, r, op, {
                    preview: lease.distribution,
                  }),
          range,
          range.kind || null,
        );
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    beginColumnResize(cell) {
      try {
        if (composing)
          throw new ReviewRequired("Finish composition before resizing");
        if (!planners.resizeColumn || !planners.previewColumnResize)
          throw new ReviewRequired("Column resizing is unavailable");
        const c = client(),
          preview = planners.previewColumnResize(c.state, cell);
        let range;
        try {
          range = capture(c.state);
        } catch {
          range = captureCellRange(c.state, preview.table, cell);
        }
        return { client: c, cell, preview, range };
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    checkColumnResize(lease) {
      if (composing)
        throw new ReviewRequired("Finish composition before resizing");
      const c = client();
      if (c !== lease.client)
        throw new ReviewRequired("Resize session changed");
      if (
        JSON.stringify(planners.previewColumnResize(c.state, lease.cell)) !==
        JSON.stringify(lease.preview)
      )
        throw new ReviewRequired(
          "Column width or row structure changed; start resizing again",
        );
    },
    commitColumnResize(lease, width) {
      try {
        this.checkColumnResize(lease);
        execute(
          (state, r, op) =>
            planners.resizeColumn(state, r, op, {
              preview: lease.preview,
              width,
            }),
          lease.range,
          lease.range.kind || null,
        );
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    beginRowResize(cell) {
      try {
        if (composing)
          throw new ReviewRequired("Finish composition before resizing");
        if (!planners.resizeRow || !planners.previewRowResize)
          throw new ReviewRequired("Row resizing is unavailable");
        const c = client(),
          preview = planners.previewRowResize(c.state, cell);
        let range;
        try {
          range = capture(c.state);
        } catch {
          range = captureCellRange(c.state, preview.table, cell);
        }
        return { client: c, cell, preview, range };
      } catch (error) {
        notice(error.message);
        return null;
      }
    },
    checkRowResize(lease) {
      if (composing)
        throw new ReviewRequired("Finish composition before resizing");
      const c = client();
      if (c !== lease.client)
        throw new ReviewRequired("Resize session changed");
      if (
        JSON.stringify(planners.previewRowResize(c.state, lease.cell)) !==
        JSON.stringify(lease.preview)
      )
        throw new ReviewRequired("Row height changed; start resizing again");
    },
    commitRowResize(lease, height) {
      try {
        this.checkRowResize(lease);
        execute(
          (state, r, op) =>
            planners.resizeRow(state, r, op, {
              preview: lease.preview,
              height,
            }),
          lease.range,
          lease.range.kind || null,
        );
        return true;
      } catch (error) {
        notice(error.message);
        return false;
      }
    },
    deleteTableStructure(axis) {
      try {
        beginTableDelete(axis);
      } catch (error) {
        notice(error.message);
      }
    },
    clearCells() {
      try {
        clearCells();
      } catch (error) {
        notice(error.message);
      }
    },
    selectCell(cell, extend = false) {
      try {
        selectCell(cell, extend);
      } catch (error) {
        notice(error.message);
      }
    },
    insertColumn(side) {
      try {
        if (composing)
          throw new ReviewRequired(
            "Finish composition before inserting a column",
          );
        if (!planners.insertColumn)
          throw new ReviewRequired(
            "Column insertion is not qualified on this surface",
          );
        const range = capture(client().state);
        execute(
          (state, r, op) => planners.insertColumn(state, r, op, { side }),
          range,
          range.kind === "cells" ? "cells" : null,
        );
        revealSelection();
      } catch (error) {
        notice(error.message);
      }
    },
    insertRow(side) {
      try {
        if (composing)
          throw new ReviewRequired("Finish composition before inserting a row");
        if (!planners.insertRow)
          throw new ReviewRequired(
            "Row insertion is not qualified on this surface",
          );
        execute((state, r, op) => planners.insertRow(state, r, op, { side }));
        revealSelection();
      } catch (error) {
        notice(error.message);
      }
    },
    navigateCell(direction) {
      try {
        navigateCell(direction);
      } catch (error) {
        notice(error.message);
      }
    },
    isComposing: () => !!composing,
    recovery: () => recovery,
    dispose() {
      disposed = true;
      cancelCut();
      root.ownerDocument.removeEventListener("keydown", cancelCut, true);
      root.ownerDocument.removeEventListener("pointerdown", cancelCut, true);
      typingStyle.clear();
      if (composing?.draft)
        keepDraft(composing.draft, "Controller closed during composition");
      composing = null;
      pendingPaste = null;
      if (onCellPasteReview) onCellPasteReview(null);
      pendingDelete = null;
      if (onTableDeleteReview) onTableDeleteReview(null);
      selectionHistory.clear();
      clearSpecialSelection(root);
      root.ownerDocument.removeEventListener(
        "selectionchange",
        selectionChanged,
      );
      for (const [name, handler] of Object.entries(handlers))
        root.removeEventListener(name, handler);
      return recovery;
    },
  };
}
