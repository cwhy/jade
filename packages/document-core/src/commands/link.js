// SPDX-License-Identifier: MPL-2.0
import {
  captureRange,
  resolveRange,
  validateDestination,
  insertionMarks,
  ReviewRequired,
} from "../selection/range.js";
import { text, findCharacter } from "../model/engine.js";
import { plainFragment } from "../fragment.js";
import { planReplace } from "./replace.js";
import { planTextFormat } from "./text-format.js";
const hrefOf = (a) =>
  a?.marks.find((m) => m.type === "link")?.attrs?.href || "";
export function validateLinkURL(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u0020\u007f]/.test(value.trim())
  )
    throw new ReviewRequired("Enter a valid http, https or mailto URL");
  const href = value.trim();
  let url;
  try {
    url = new URL(href);
  } catch {
    throw new ReviewRequired("Enter a complete URL, including https://");
  }
  if (
    !["http:", "https:", "mailto:"].includes(url.protocol) ||
    (url.protocol === "mailto:" ? !url.pathname : !url.hostname)
  )
    throw new ReviewRequired("Only http, https and mailto links are supported");
  return href;
}
export function linkContext(state, range) {
  if (
    range.kind ||
    range.epoch !== state.epoch ||
    range.slices.some((s) => s.type === "code")
  )
    throw new ReviewRequired("Select prose to edit a link");
  if (range.collapsed) {
    const { focus } = resolveRange(state, range),
      atoms = text(state, focus.block),
      href = hrefOf(atoms[focus.offset]) || hrefOf(atoms[focus.offset - 1]);
    if (href) {
      let from = focus.offset,
        to = focus.offset;
      while (from > 0 && hrefOf(atoms[from - 1]) === href) from--;
      while (to < atoms.length && hrefOf(atoms[to]) === href) to++;
      range = captureRange(
        state,
        { block: focus.block, offset: from },
        { block: focus.block, offset: to },
      );
    }
  }
  const atoms = range.slices.flatMap((s) => s.atoms),
    urls = atoms.map(hrefOf),
    href = urls.length && urls.every((x) => x && x === urls[0]) ? urls[0] : "";
  return {
    range,
    href,
    label: range.slices
      .map((s) => s.atoms.map((a) => a.char).join(""))
      .join("\n"),
    labelEditable: range.slices.length === 1,
  };
}
export function checkLinkTarget(state, context) {
  resolveRange(state, context.range);
  if (
    !context.range.collapsed &&
    !context.range.slices.some((s) =>
      s.atoms.some((a) => findCharacter(state, a.id)),
    )
  )
    throw new ReviewRequired("Linked text was deleted");
}
export function planLink(
  state,
  context,
  op,
  { href, label = context.label, remove = false },
) {
  checkLinkTarget(state, context);
  if (remove)
    return planTextFormat(state, context.range, op, {
      property: "link",
      value: null,
    });
  href = validateLinkURL(href);
  if (!context.range.collapsed && label === context.label)
    return planTextFormat(state, context.range, op, {
      property: "link",
      value: { type: "link", attrs: { href } },
    });
  if (
    !context.labelEditable ||
    typeof label !== "string" ||
    /[\r\n]/.test(label)
  )
    throw new ReviewRequired("Change labels within one prose paragraph");
  validateDestination(state, context.range);
  const style = insertionMarks(state, context.range).filter(
    (m) => (typeof m === "string" ? m : m.type) !== "link",
  );
  style.push({ type: "link", attrs: { href } });
  return planReplace(
    state,
    context.range,
    plainFragment(label || href, style),
    op,
    { strict: true },
  );
}
