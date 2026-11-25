// SPDX-License-Identifier: MPL-2.0
import {
  conversionCodeRecord,
  conversionLayout,
  languageOwner,
} from "./text-conversion.js";
// Shared code metadata uses owned, ordered contributions. View preferences and
// syntax-highlighter output never enter this ledger or the text replicas.
export const CODE_LANGUAGES = Object.freeze([
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "sql",
  "json",
  "html",
  "css",
  "bash",
  "yaml",
  "markdown",
]);
const has = (node) => Object.hasOwn(node, "language");
const chosen = (ledger) =>
  ledger?.layers.findLast((layer) => layer.active && !layer.automatic) ||
  ledger?.layers.findLast((layer) => layer.active);
export function codeLanguageState(node) {
  if (!node || node.type !== "code") throw Error("Choose a code block");
  const ledger = node.codeLanguages;
  const active = chosen(ledger);
  return {
    language: active?.language ?? (node.language || "plaintext"),
    explicit:
      !!(active && !active.automatic) || (ledger ? ledger.present : has(node)),
    contribution: active?.id ?? null,
  };
}
// A merged block has its own choices, with a read-only default derived from
// original histories. Editing the merged language never writes those sources.
export function effectiveLanguageRecord(state, raw, seen = new Set()) {
  const node = languageOwner(state, raw);
  if (!node.languageOrigins) return node;
  if (seen.has(node)) throw Error("Cyclic merged language origins");
  const path = new Set(seen);
  path.add(node);
  const values = node.languageOrigins.map((origin) =>
    origin.source === null
      ? { language: "plaintext", explicit: false }
      : codeLanguageState(
          codeRecord(
            effectiveLanguageRecord(
              state,
              { languageSource: origin.source },
              path,
            ),
          ),
        ),
  );
  const common = values.every((v) => v.language === values[0].language),
    language = common ? values[0].language : "plaintext";
  const explicit = !common || values.some((v) => v.explicit);
  const local = node.codeLanguages;
  const virtual = { ...node };
  if (!chosen(local)) virtual.language = local?.present ? local.base : language;
  virtual.codeLanguages = {
    ...(local || { layers: [] }),
    present: local?.present || explicit,
    base: local?.present ? local.base : language,
  };
  return virtual;
}
function targetRecord(state, intent) {
  if (intent.conversion !== undefined)
    return languageOwner(
      state,
      conversionCodeRecord(state, intent.conversion, intent.block),
    );
  const node = state.nodes[intent.block];
  if (!node?.live || node.type !== "code")
    throw Error("Code block is unavailable; restore it before editing");
  return node;
}
const codeRecord = (record) => ({ ...record, type: "code" });
export function validateCodeLanguage(state, intent) {
  const record = targetRecord(state, intent);
  if (!CODE_LANGUAGES.includes(intent.language))
    throw Error("Unsupported code language");
  return record;
}
function writeLanguage(state, intent, next, write) {
  if (next.kind === "textConvert") {
    const root = state.nodes[state.root];
    write("nodes")[root.id] = {
      ...root,
      textConversions: root.textConversions.map((e) =>
        e.id === next.id ? next : e,
      ),
    };
  } else write("nodes")[next.id] = next;
}

function project(node, ledger) {
  const next = { ...node, codeLanguages: ledger },
    active = chosen(ledger);
  if (active) next.language = active.language;
  else if (ledger.present) next.language = ledger.base;
  else delete next.language;
  return next;
}
export function executeCodeLanguage(state, intent, action, { write, fail }) {
  const automatic = intent.kind === "codeLanguageAuto",
    adding = automatic || intent.kind === "codeLanguage",
    node = adding
      ? validateCodeLanguage(state, intent)
      : targetRecord(state, intent);
  // Detection is merely a default. A stale paste still inserts its text, but
  // cannot change the language after any intervening accepted document edit.
  const group =
    intent.conversion !== undefined
      ? conversionLayout(
          state,
          conversionCodeRecord(state, intent.conversion, intent.block).parent,
        ).find(
          (g) => g.conversion === intent.conversion && g.id === intent.block,
        )
      : null;
  const size =
    intent.conversion !== undefined
      ? group
        ? group.blocks.reduce(
            (n, id) => n + state.replicas[state.nodes[id].text].length,
            0,
          ) +
          group.blocks.length -
          1
        : Infinity
      : state.replicas[node.text]?.length;
  if (
    automatic &&
    (state.revision !== intent.revision ||
      codeLanguageState(codeRecord(effectiveLanguageRecord(state, node)))
        .explicit ||
      size !== 0)
  )
    return { kind: "batch", intents: [] };
  const ledger = node.codeLanguages || {
    present: has(node),
    base: has(node) ? node.language : null,
    layers: [],
  };
  if (
    adding
      ? ledger.layers.some((layer) => layer.id === action)
      : !ledger.layers.some((layer) => layer.id === intent.target)
  )
    throw fail("Code language contribution is unavailable or reused");
  const layers = adding
    ? [
        ...ledger.layers,
        {
          id: action,
          language: intent.language,
          active: true,
          ...(automatic ? { automatic: true } : {}),
        },
      ]
    : ledger.layers.map((layer) =>
        layer.id === intent.target
          ? { ...layer, active: intent.active }
          : layer,
      );
  writeLanguage(state, intent, project(node, { ...ledger, layers }), write);
  return {
    kind: "codeLanguageActive",
    block: intent.block,
    ...(intent.conversion !== undefined
      ? { conversion: intent.conversion }
      : {}),
    target: adding ? action : intent.target,
    active: adding ? false : !intent.active,
  };
}
export function validateCodeLanguages(state) {
  const conversions = state.nodes[state.root].textConversions || [];
  for (const raw of conversions) {
    if (raw.languageOrigins) effectiveLanguageRecord(state, raw);
    if (
      raw.languageSource &&
      (raw.codeLanguages !== undefined || Object.hasOwn(raw, "language"))
    )
      throw Error("Remembered code language must have one owner");
    if (
      (raw.codeLanguages !== undefined || Object.hasOwn(raw, "language")) &&
      raw.target !== "code"
    )
      throw Error("Language metadata requires a code conversion");
  }
  for (const node of [
    ...Object.values(state.nodes),
    ...conversions.map(codeRecord),
  ]) {
    const ledger = node.codeLanguages;
    if (ledger === undefined) continue;
    if (
      node.type !== "code" ||
      !ledger ||
      typeof ledger !== "object" ||
      Object.keys(ledger).some(
        (k) => !["present", "base", "layers"].includes(k),
      ) ||
      typeof ledger.present !== "boolean" ||
      !Array.isArray(ledger.layers) ||
      (ledger.present ? typeof ledger.base !== "string" : ledger.base !== null)
    )
      throw Error("Invalid code language ledger");
    const ids = new Set();
    for (const layer of ledger.layers) {
      if (
        !layer ||
        Object.keys(layer).some(
          (k) => !["id", "language", "active", "automatic"].includes(k),
        ) ||
        typeof layer.id !== "string" ||
        !layer.id ||
        ids.has(layer.id) ||
        typeof layer.active !== "boolean" ||
        (Object.hasOwn(layer, "automatic") && layer.automatic !== true) ||
        !CODE_LANGUAGES.includes(layer.language)
      )
        throw Error("Invalid code language contribution");
      ids.add(layer.id);
    }
    const expected = project(node, ledger);
    if (has(node) !== has(expected) || node.language !== expected.language)
      throw Error("Code language projection mismatch");
  }
}
// Undo of a language choice retains its history for Redo, but that inactive
// history alone must not prevent Undo of the block's original insertion.
export function structuralLanguageShape(node) {
  if (
    !node.codeLanguages ||
    node.codeLanguages.layers.some((layer) => layer.active)
  )
    return node;
  const { codeLanguages, ...shape } = node;
  return shape;
}
