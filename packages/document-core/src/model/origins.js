// SPDX-License-Identifier: MPL-2.0
import { members as erasureMembers } from "./boundaries.js";
// Erasure metadata belongs to the retained operation, whether the next inverse
// is held directly by history or by a lifecycle record referenced from history.
// Every origin lookup uses the same ownership traversal.
function scanOwnedInverses(state, visit) {
  for (const effect of Object.values(state.effects)) visit(effect.inverse);
  for (const mask of Object.values(state.textMasks || {})) visit(mask.inverse);
  for (const creation of Object.values(state.creations || {})) {
    if (creation.contentInverse) visit(creation.contentInverse);
    if (creation.sourceInverse) visit(creation.sourceInverse);
  }
  for (const placement of Object.values(state.creationPlacements || {}))
    visit(placement.inverse);
}
// Experimental codec 7: a displaced insertion retains its erased source gap.
// Effects already retain insertion identities; compact origin metadata follows
// that same Undo lifetime. No current DOM offset becomes a restoration identity.
export function insertionOrigin(state, intent) {
  const g = intent.at;
  if (g?.codec !== 2 || (!state.deleted[g.left] && !state.deleted[g.right]))
    return null;
  return {
    text: g.text,
    generation: g.generation,
    offset: g.offset,
    left: g.left,
    right: g.right,
  };
}
export function restorationParts(
  state,
  intent,
  action,
  parts,
  { atoms, locations, remember, conflict },
) {
  const erased = atoms(intent.pieces),
    offsets = new Map(erased.map((a, i) => [a.id, i])),
    origins = [],
    seen = new Set();
  function scan(inverse) {
    if (inverse.kind === "batch") for (const i of inverse.intents) scan(i);
    if (inverse.kind !== "delete" || !inverse.origin) return;
    const o = inverse.origin,
      at = erasedOffset(offsets, o, erased.length, state, intent.erasure);
    if (at === null) return; // Interior or exact edge of this erased run.
    const live = inverse.ids.map((id) => locations.get(id)).filter(Boolean);
    if (!live.length) return;
    if (new Set(live.map((p) => p.block)).size !== 1)
      throw conflict(
        "Origin restoration spans independently split contributions; review required",
      );
    const key = JSON.stringify(inverse.ids);
    if (seen.has(key)) return;
    seen.add(key);
    origins.push({
      at,
      block: live[0].block,
      before: Math.min(...live.map((p) => p.offset)),
      after: Math.max(...live.map((p) => p.offset)) + 1,
    });
  }
  scanOwnedInverses(state, scan);
  if (!origins.length) return parts;
  const expanded = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i],
      end = parts[i + 1]?.at ?? erased.length,
      relevant = origins.filter((o) => o.at >= part.at && o.at <= end);
    for (const o of relevant.filter((o) => o.block !== part.block)) {
      const family = Object.values(state.listFamilies || {}).find((f) =>
          f.layout.blocks.includes(part.block),
        ),
        blocks = family?.layout.blocks || [],
        p = blocks.indexOf(part.block),
        q = blocks.indexOf(o.block);
      if (
        !(
          (o.at === part.at && q === p - 1 && q >= 0) ||
          (o.at === end && q === p + 1)
        )
      )
        throw conflict(
          "Origin restoration crossed an independent structural change; review required",
        );
    }
    // An edge contribution in the adjacent partition is already ordered by the
    // retained list cut. It must not pull restored characters across that cut.
    const islands = relevant.filter((o) => o.block === part.block);
    const edges = [
      ...new Set([part.at, ...islands.map((o) => o.at), end]),
    ].sort((a, b) => a - b);
    for (let j = 0; j < edges.length - 1; j++) {
      const a = edges[j],
        b = edges[j + 1],
        right = islands.filter((o) => o.at === b),
        left = islands.filter((o) => o.at === a);
      const offset = right.length
        ? Math.min(...right.map((o) => o.before))
        : left.length
          ? Math.max(...left.map((o) => o.after))
          : part.offset;
      const id = `${action}:origin-segment:${expanded.length}`;
      remember(id, part.block, offset);
      expanded.push({
        id,
        at: a,
        block: part.block,
        offset,
        originSegment: true,
      });
    }
  }
  return expanded;
}

// Several offline inserts can collapse onto one visible gap. Preserve their
// source ordering there, so later restoration never has to guess from arrival order.
export function originPlacement(state, origin, fallback, { atoms, locations }) {
  if (!origin) return fallback;
  const records = [];
  function scan(i) {
    if (i.kind === "batch") i.intents.forEach(scan);
    else records.push(i);
  }
  scanOwnedInverses(state, scan);
  for (const erased of records.filter(
    (i) => i.erasure && state.erasures[i.erasure] && i.pieces,
  )) {
    const deleted = atoms(erased.pieces),
      offsets = new Map(deleted.map((a, i) => [a.id, i])),
      at = erasedOffset(offsets, origin, deleted.length, state, erased.erasure);
    if (at === null) continue;
    const candidates = [];
    for (const record of records) {
      if (!record.origin || record.kind !== "delete") continue;
      const pos = erasedOffset(
        offsets,
        record.origin,
        deleted.length,
        state,
        erased.erasure,
      );
      if (pos === null) continue;
      const live = record.ids.map((id) => locations.get(id)).filter(Boolean);
      if (!live.length || live.some((p) => p.block !== fallback.block))
        continue;
      candidates.push({
        pos,
        before: Math.min(...live.map((p) => p.offset)),
        after: Math.max(...live.map((p) => p.offset)) + 1,
      });
    }
    const right = candidates
      .filter((c) => c.pos > at)
      .sort((a, b) => a.pos - b.pos || a.before - b.before)[0];
    if (right) return { block: fallback.block, offset: right.before };
    const left = candidates
      .filter((c) => c.pos <= at)
      .sort((a, b) => b.pos - a.pos || b.after - a.after)[0];
    if (left) return { block: fallback.block, offset: left.after };
  }
  return fallback;
}

// A gap at an erased run's edge is as meaningful as one in its interior.
function erasedOffset(offsets, g, size, state = null, erasure = null) {
  const left = offsets.get(g.left),
    right = offsets.get(g.right);
  if (left !== undefined && right === left + 1) return right;
  if (left === size - 1 && right === undefined) return size;
  if (right === 0 && left === undefined) return 0;
  // A one-sided gap at a split paragraph edge can be interior to a larger
  // erased run. Accept it only with a retained cut proving that exact offset
  // and authored side; a missing neighbour alone is not sufficient evidence.
  if (state && g.listAffinity) {
    for (const [key, entry] of Object.entries(state.erasures)) {
      if (erasure && key !== erasure) continue;
      for (const [ordinal, at] of erasureMembers(state, entry)) {
        const marker = state.boundaryOrder[ordinal],
          side = g.listAffinity[marker];
        if (
          (side === "right" && g.left === null && right === at) ||
          (side === "left" && g.right === null && left + 1 === at)
        )
          return at;
      }
    }
  }
  return null;
}
// If all source atoms disappeared after a split, the retained erasure marker
// supplies a live destination. Never guess another paragraph by visible text.
export function erasedGapPlacement(state, g, { atoms }) {
  const records = [];
  function scan(i) {
    if (i.kind === "batch") i.intents.forEach(scan);
    else records.push(i);
  }
  scanOwnedInverses(state, scan);
  for (const record of records) {
    if (!record.erasure || !state.erasures[record.erasure] || !record.pieces)
      continue;
    const deleted = atoms(record.pieces),
      at = erasedOffset(
        new Map(deleted.map((a, i) => [a.id, i])),
        g,
        deleted.length,
      );
    if (at === null) continue;
    const marker = state.boundaries[record.at.boundary];
    if (marker && state.nodes[marker.block]?.live)
      return { block: marker.block, offset: marker.offset };
  }
  return null;
}

// At a restored erased offset, a cut and an offline contribution can coincide.
// Restore their accepted side relationship, not just the cut's numeric offset.
export function restoredCutOffsets(state, pieces, block, { atoms, locations }) {
  const erased = atoms(pieces),
    ordinals = new Map(erased.map((a, i) => [a.id, i])),
    byMarker = new Map();
  // Scope this derived lookup to one restored part. The caller changes only
  // marker offsets while using it; histories and live text stay fixed. Never
  // retain it across another insertion, partition, or owned inverse update.
  function scan(i) {
    if (i.kind === "batch") {
      i.intents.forEach(scan);
      return;
    }
    if (i.kind !== "delete" || !i.origin?.listAffinity) return;
    for (const [marker, side] of Object.entries(i.origin.listAffinity)) {
      if (!side) continue;
      if (!byMarker.has(marker)) byMarker.set(marker, []);
      byMarker.get(marker).push({ inverse: i, side });
    }
  }
  scanOwnedInverses(state, scan);
  return (marker, offset, fallback) => {
    let left = -Infinity,
      right = Infinity;
    for (const { inverse: i, side } of byMarker.get(marker) || []) {
      if (erasedOffset(ordinals, i.origin, erased.length, state) !== offset)
        continue;
      for (const id of i.ids) {
        const p = locations.get(id);
        if (p?.block !== block) continue;
        if (side === "left") left = Math.max(left, p.offset);
        else right = Math.min(right, p.offset);
      }
    }
    if (right !== Infinity) return right;
    if (left !== -Infinity) return left + 1;
    return fallback;
  };
}

// Return exact active erasure positions for a new cut's authored source gap.
// This extends the same source-affiliation rule already used by offline typing.
export function erasedBoundaryOrigins(state, g, { atoms, cuts }) {
  if (g?.codec === 3)
    return Object.keys(state.erasures).flatMap((key) =>
      cuts(key)
        .filter(([id]) => id === g.boundary)
        .map(([, at]) => ({ key, at })),
    );
  if (g?.codec !== 2) return [];
  const records = [];
  function scan(i) {
    if (i.kind === "batch") i.intents.forEach(scan);
    else records.push(i);
  }
  scanOwnedInverses(state, scan);
  const result = [],
    seen = new Set();
  for (const record of records) {
    if (
      !record.erasure ||
      seen.has(record.erasure) ||
      !state.erasures[record.erasure] ||
      !record.pieces
    )
      continue;
    const erased = atoms(record.pieces),
      at = erasedOffset(
        new Map(erased.map((a, i) => [a.id, i])),
        g,
        erased.length,
        state,
        record.erasure,
      );
    if (at !== null) {
      result.push({ key: record.erasure, at });
      seen.add(record.erasure);
    }
  }
  return result;
}
