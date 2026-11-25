// SPDX-License-Identifier: MPL-2.0
import { documentView } from "../document/read.js";
import { apply, text } from "../model/engine.js";
import { codeLanguageState, CODE_LANGUAGES } from "../model/code-language.js";
import { literalFragment } from "../fragment.js";
import { planReplace } from "./replace.js";
// The host supplies a bounded synchronous classification, never highlighter HTML.
// The engine owns eligibility, authority revalidation and the single Undo unit.
export function planCodePaste(
  state,
  range,
  value,
  op,
  { language = "plaintext", inheritedMarks = [] } = {},
) {
  if (
    range.kind ||
    range.slices.length !== 1 ||
    range.slices[0].type !== "code"
  )
    throw Error("Choose a code text range");
  if (!CODE_LANGUAGES.includes(language))
    throw Error("Unsupported detected code language");
  const view = documentView(state),
    node = view.node(range.slices[0].block);
  const block = range.slices[0].block,
    fragment = literalFragment(value),
    options = { plainText: true, strict: true, inheritedMarks };
  if (!value || codeLanguageState(node).explicit || view.length(block))
    return planReplace(state, range, fragment, op, options);
  const replacement = planReplace(
    state,
    range,
    fragment,
    { ...op, id: op.id + ":part:1" },
    options,
  );
  if (!replacement.intent) return replacement;
  const intent = {
    kind: "batch",
    intents: [
      {
        kind: "codeLanguageAuto",
        block,
        language,
        revision: state.revision,
        ...(node.codeConversion ? { conversion: node.codeConversion } : {}),
      },
      replacement.intent,
    ],
  };
  return { ...replacement, intent, state: apply(state, { ...op, intent }) };
}
