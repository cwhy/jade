// SPDX-License-Identifier: MPL-2.0
import { documentView } from "../document/read.js";
import { apply } from "../model/engine.js";
import { validateCodeLanguage } from "../model/code-language.js";
export { CODE_LANGUAGES, codeLanguageState } from "../model/code-language.js";
export function planCodeLanguage(state, block, language, op) {
  const node = documentView(state).node(block);
  if (node?.type !== "code") throw Error("Choose an available code block");
  const intent = {
    kind: "codeLanguage",
    block,
    language,
    ...(node.codeConversion ? { conversion: node.codeConversion } : {}),
  };
  validateCodeLanguage(state, intent);
  return { intent, state: apply(state, { ...op, intent }) };
}
