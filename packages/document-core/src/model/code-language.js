// SPDX-License-Identifier: MPL-2.0
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
export function validateCodeLanguage(state, intent) {
  const node = state.nodes[intent.block];
  if (!node?.live || node.type !== "code")
    throw Error("Code block is no longer available");
  if (!CODE_LANGUAGES.includes(intent.language))
    throw Error("Unsupported code language");
  return node;
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
      : state.nodes[intent.block];
  if (!node?.live || node.type !== "code")
    throw fail("Code block is unavailable; restore it before Undo");
  // Detection is merely a default. A stale paste still inserts its text, but
  // cannot change the language after any intervening accepted document edit.
  if (
    automatic &&
    (state.revision !== intent.revision ||
      codeLanguageState(node).explicit ||
      state.replicas[node.text]?.length !== 0)
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
  write("nodes")[node.id] = project(node, { ...ledger, layers });
  return {
    kind: "codeLanguageActive",
    block: node.id,
    target: adding ? action : intent.target,
    active: adding ? false : !intent.active,
  };
}
export function validateCodeLanguages(state) {
  for (const node of Object.values(state.nodes)) {
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
