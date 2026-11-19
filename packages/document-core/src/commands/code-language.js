// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { validateCodeLanguage } from "../model/code-language.js";
export { CODE_LANGUAGES, codeLanguageState } from "../model/code-language.js";
export function planCodeLanguage(state, block, language, op) {
  const intent = { kind: "codeLanguage", block, language };
  validateCodeLanguage(state, intent);
  return { intent, state: apply(state, { ...op, intent }) };
}
