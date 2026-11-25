// SPDX-License-Identifier: MPL-2.0
// Source order is independent of presentation and of each origin's Undo owner.
import { scopeProjection } from "./conversion-scope.js";
import { proseProjectionSources } from "./join-ledger.js";
export function originScopes(entry) {
  return [
    ...new Set(
      [entry.scope, ...(entry.origins || []).map((o) => o.scope)].filter(
        Boolean,
      ),
    ),
  ];
}
export function conversionProjection(state, entry) {
  if (!entry.origins)
    return entry.scope
      ? scopeProjection(state, entry.parent, entry.scope)
      : proseProjectionSources(state, entry.parent);
  const direct = proseProjectionSources(state, entry.parent),
    scopes = new Map(
      originScopes(entry).map((id) => [
        id,
        scopeProjection(state, entry.parent, id),
      ]),
    );
  const owner = new Map(direct.owner),
    sources = new Map(direct.sources);
  for (const p of scopes.values()) {
    for (const [id, value] of p.owner) owner.set(id, value);
    for (const [id, value] of p.sources) sources.set(id, value);
  }
  return {
    children: direct.children.flatMap((id) => scopes.get(id)?.children || [id]),
    owner,
    sources,
  };
}
export function subsetOrigins(origins, windows) {
  if (!origins) return undefined;
  const chosen = new Set(windows.map((w) => w.source));
  return origins
    .map((o) => ({
      scope: o.scope,
      sources: o.sources.filter((id) => chosen.has(id)),
    }))
    .filter((o) => o.sources.length);
}
export function validateOrigins(state, entry) {
  if (!entry.origins) return;
  if (entry.scope || !Array.isArray(entry.origins) || !entry.origins.length)
    throw Error("Invalid conversion origins");
  const scopes = new Set(),
    sources = new Set();
  for (const o of entry.origins) {
    if (
      !o ||
      Object.keys(o).sort().join(",") !== "scope,sources" ||
      !(o.scope === null || typeof o.scope === "string") ||
      scopes.has(o.scope) ||
      !Array.isArray(o.sources) ||
      !o.sources.length
    )
      throw Error("Invalid conversion origin");
    scopes.add(o.scope);
    const p = o.scope
      ? scopeProjection(state, entry.parent, o.scope)
      : proseProjectionSources(state, entry.parent);
    for (const id of o.sources) {
      // Source roots remain present in retained ordering, including projected joins.
      if (typeof id !== "string" || sources.has(id) || !p.owner.has(id))
        throw Error("Conversion origin left its container");
      sources.add(id);
    }
  }
  const expected = new Set(entry.windows.map((w) => w.source));
  if (
    expected.size !== sources.size ||
    [...expected].some((id) => !sources.has(id))
  )
    throw Error("Conversion origins must cover source windows exactly");
}
