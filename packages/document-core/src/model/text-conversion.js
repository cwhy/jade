// SPDX-License-Identifier: MPL-2.0
import { sourceRecordRetired } from "./source-lifecycle.js";
// Experimental conversion ledger. Canonical text and cut identities survive
// presentation changes; the shared document reader supplies effective blocks.
import {
  scopeProjection,
  listScopeLeaves,
  listScopeSections,
  captureListItems,
  selectedListLeaves,
  projectListScope,
  retainedItemMembers,
} from "./conversion-scope.js";
import {
  captureConversionNumbering,
  validateConversionNumbering,
  retainedNumbering,
} from "./conversion-numbering.js";
import {
  projectDisplayJoins,
  validateDisplayLedger,
} from "./display-boundary.js";
import {
  originScopes,
  conversionProjection,
  subsetOrigins,
  validateOrigins,
} from "./conversion-origins.js";
import { retainedSourceSpans } from "./retained-source-spans.js";
import { text, resolveGap } from "./engine.js";
import {
  compactIdentities,
  validateIdentitySpans,
} from "../text/identity-spans.js";
import { identities } from "../text/pieces.js";
import { propertyOf, checkFormat } from "../text/formatting-contributions.js";
import { proseProjectionSources } from "./join-ledger.js";
const keys = (o, allowed) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).every((k) => allowed.includes(k));
const fail = (message) => {
  throw Error("Text conversion proof: " + message);
};
const ledger = (state) => state.nodes[state.root].textConversions || [];
// Structural ownership stays with each original conversion. A later style may
// depend on several originals without combining their marker slots or Undo.
const basisIds = (entry) => entry.bases || (entry.basis ? [entry.basis] : []);
const hasBasis = (entry) => basisIds(entry).length > 0;
const originalBases = (state, entry) =>
  hasBasis(entry)
    ? basisIds(entry).map((id) => ledger(state).find((e) => e.id === id))
    : [entry];
const familyFor = (state, block) =>
  Object.values(state.listFamilies).find(
    (f) => f.kind !== "flow" && f.layout.blocks.includes(block),
  );
const sourceFamily = (state, source) =>
  Object.values(state.listFamilies).find(
    (f) => f.kind !== "flow" && f.source === source,
  );
const activeCuts = (f) =>
  f.order.filter((id) => id !== "home" && f.cuts[id].active);
export function windowFor(state, block) {
  const family = familyFor(state, block);
  if (!family) return { source: block, left: null, right: null };
  const cuts = activeCuts(family),
    index = family.layout.blocks.indexOf(block);
  return {
    source: family.source,
    left: cuts[index - 1] ?? null,
    right: cuts[index] ?? null,
  };
}
export function members(state, extent) {
  const family = sourceFamily(state, extent.source);
  if (!family) {
    if (extent.left !== null || extent.right !== null)
      fail("missing retained partition fence");
    return [extent.source];
  }
  // A removed fence can combine selected and unselected source. Do not silently
  // adopt the other side; this shape is outside this bounded candidate.
  for (const id of [extent.left, extent.right])
    if (id !== null && !family.cuts[id]?.active)
      fail("inactive selected partition fence");
  const cuts = activeCuts(family),
    blocks = [family.source, ...cuts.map((id) => family.cuts[id].block)];
  const start = extent.left === null ? 0 : cuts.indexOf(extent.left) + 1;
  const end =
    extent.right === null ? blocks.length : cuts.indexOf(extent.right) + 1;
  if (start < 0 || end <= start) fail("invalid partition extent");
  return blocks.slice(start, end);
}
export function boundaryBefore(state, block) {
  const family = familyFor(state, block);
  const cut =
    family &&
    Object.values(family.cuts).find((c) => c.block === block && c.active);
  return cut ? "cut:" + cut.id : "seed:" + block;
}
export function contributionMembers(state, entry) {
  const ids = [...new Set(entry.windows.flatMap((w) => members(state, w)))];
  const parent = state.nodes[entry.parent],
    projected = conversionProjection(state, entry),
    children = projected.children;
  if (
    !parent?.live ||
    !["doc", "cell"].includes(parent.type) ||
    ids.some((id) => !projected.owner.has(id))
  )
    fail("source moved or hidden");
  // Retained claims refer to their original sources, even when a later join
  // projects those sources into the same visible paragraph. Capture expands
  // new visible selections; historical claims must never expand with them.
  const sorted = ids.sort((a, b) => children.indexOf(a) - children.indexOf(b));
  if (
    sorted.some(
      (id, i) =>
        !["paragraph", "code"].includes(state.nodes[id]?.type) ||
        (i && children.indexOf(id) !== children.indexOf(sorted[i - 1]) + 1),
    )
  )
    fail("source no longer contiguous text");
  return sorted;
}
export function captureConversion(
  state,
  parent,
  blocks,
  target,
  scope = null,
  basis = null,
  origins = null,
) {
  if (
    !Array.isArray(blocks) ||
    !blocks.length ||
    new Set(blocks).size !== blocks.length
  )
    fail("select ordinary paragraphs");
  const projected = conversionProjection(state, { parent, scope, origins });
  blocks = blocks.flatMap((block) => projected.sources.get(block) || [block]);
  // Only exterior fences define the selected extent. An internal cut selected
  // on both sides remains owned by its author; conversion must not retain it.
  const windows = [];
  for (const block of blocks) {
    const next = windowFor(state, block),
      previous = windows.at(-1);
    if (
      previous &&
      previous.source === next.source &&
      previous.right !== null &&
      previous.right === next.left
    )
      previous.right = next.right;
    else windows.push(next);
  }
  if (origins) {
    origins = subsetOrigins(origins, windows);
    if (Array.isArray(basis))
      basis = basis.filter((id) =>
        originScopes({ origins }).includes(
          ledger(state).find((e) => e.id === id)?.scope,
        ),
      );
    if (Array.isArray(basis) && !basis.length) basis = null;
  }
  const intent = {
    kind: "textConvert",
    ...(scope ? { scope } : {}),
    ...(origins ? { origins: subsetOrigins(origins, windows) } : {}),
    ...(basis ? (Array.isArray(basis) ? { bases: basis } : { basis }) : {}),
    parent,
    target,
    windows,
    edges:
      target === "paragraph"
        ? blocks.slice(1).map((id) => boundaryBefore(state, id))
        : [],
  };
  if (target === "code") {
    const remembered = rememberedLanguageSource(state, parent, blocks);
    if (remembered) intent.languageSource = remembered;
    else {
      const memories = rememberedLanguageOrigins(
        state,
        parent,
        blocks,
        scope,
        basis,
        origins,
      );
      if (memories) intent.languageOrigins = memories;
    }
  }
  validateConversion(state, intent);
  if (
    JSON.stringify(contributionMembers(state, intent)) !==
    JSON.stringify(blocks)
  )
    fail("select in document order");
  return intent;
}
export function validateConversion(state, intent) {
  if (
    !keys(intent, [
      "kind",
      "parent",
      "target",
      "windows",
      "edges",
      "loss",
      "scope",
      "origins",
      "basis",
      "bases",
      "languageSource",
      "languageOrigins",
    ]) ||
    intent.kind !== "textConvert" ||
    (intent.scope !== undefined &&
      (typeof intent.scope !== "string" ||
        (intent.target !== "code" && !hasBasis(intent)))) ||
    !["code", "paragraph"].includes(intent.target) ||
    typeof intent.parent !== "string" ||
    !Array.isArray(intent.windows) ||
    !intent.windows.length ||
    !Array.isArray(intent.edges) ||
    intent.edges.some((x) => typeof x !== "string") ||
    new Set(intent.edges).size !== intent.edges.length ||
    (intent.target === "code" && intent.edges.length)
  )
    fail("invalid conversion");
  if (
    intent.basis !== undefined &&
    (typeof intent.basis !== "string" || (!intent.scope && !intent.origins))
  )
    fail("Invalid conversion basis");
  if (
    intent.bases !== undefined &&
    (intent.basis !== undefined ||
      (!intent.scope && !intent.origins) ||
      !Array.isArray(intent.bases) ||
      intent.bases.length < (intent.origins ? 1 : 2) ||
      intent.bases.some((id) => typeof id !== "string") ||
      new Set(intent.bases).size !== intent.bases.length)
  )
    fail("Invalid shared conversion bases");
  for (const w of intent.windows)
    if (
      !keys(w, ["source", "left", "right"]) ||
      typeof w.source !== "string" ||
      !state.nodes[w.source] ||
      ![w.left, w.right].every((x) => x === null || typeof x === "string")
    )
      fail("invalid partition extent");
  if (intent.loss !== undefined) {
    if (intent.target !== "code" || !Array.isArray(intent.loss))
      fail("invalid loss review");
    for (const entry of intent.loss) {
      if (
        !keys(entry, ["property", "value", "ids", "idSpans"]) ||
        entry.value === null ||
        Object.hasOwn(entry, "ids") === Object.hasOwn(entry, "idSpans")
      )
        fail("invalid formatting loss witness");
      if (entry.idSpans) validateIdentitySpans(state, entry.idSpans);
      else if (
        !Array.isArray(entry.ids) ||
        !entry.ids.length ||
        entry.ids.some((id) => typeof id !== "string") ||
        new Set(entry.ids).size !== entry.ids.length
      )
        fail("invalid formatting loss witness");
      checkFormat(entry.property, entry.value);
    }
  }
  validateOrigins(state, intent);
  const ids = contributionMembers(state, intent),
    possible = new Set(ids.slice(1).map((id) => boundaryBefore(state, id)));
  if (hasBasis(intent)) {
    const roots = originalBases(state, intent);
    for (const basis of roots) {
      if (
        !basis?.scope ||
        hasBasis(basis) ||
        basis.parent !== intent.parent ||
        !originScopes(intent).includes(basis.scope) ||
        !basis.listGroup
      )
        fail("Unknown scoped conversion basis");
    }
    const allowed = roots.map(
      (basis) => new Set(contributionMembers(state, basis)),
    );
    if (
      ids.some(
        (id) =>
          allowed.filter((set) => set.has(id)).length !==
          (intent.origins &&
          proseProjectionSources(state, intent.parent).owner.has(id)
            ? 0
            : 1),
      )
    )
      fail("Conversion needs exactly one original owner per source");
  }
  if (intent.origins && originScopes(intent).length && !hasBasis(intent))
    fail("Cross-origin style requires original conversion owners");
  if (intent.languageSource !== undefined) {
    if (intent.target !== "code") fail("Only code may remember a language");
    const owner = languageOwner(state, intent);
    if (!sameLanguageExtent(state, owner, ids))
      fail("Remembered language source changed scope");
  }
  if (intent.languageOrigins !== undefined) {
    if (
      intent.target !== "code" ||
      intent.languageSource ||
      !Array.isArray(intent.languageOrigins) ||
      intent.languageOrigins.length < 1
    )
      fail("Invalid merged language origins");
    const covered = [];
    for (const origin of intent.languageOrigins) {
      if (
        !keys(origin, ["windows", "source"]) ||
        !Array.isArray(origin.windows) ||
        !origin.windows.length ||
        !Object.hasOwn(origin, "source")
      )
        fail("Invalid language origin");
      // Reuse the source-window validator without recursively retaining origins.
      const section = {
        kind: "textConvert",
        parent: intent.parent,
        target: "code",
        windows: origin.windows,
        edges: [],
        ...(intent.scope ? { scope: intent.scope } : {}),
        ...(intent.origins
          ? { origins: subsetOrigins(intent.origins, origin.windows) }
          : {}),
        ...(intent.basis ? { basis: intent.basis } : {}),
        ...(intent.bases ? { bases: intent.bases } : {}),
      };
      if (section.origins && section.bases) {
        section.bases = section.bases.filter((id) =>
          originScopes(section).includes(
            ledger(state).find((e) => e.id === id)?.scope,
          ),
        );
        if (!section.bases.length) delete section.bases;
      }
      validateConversion(state, section);
      const members = contributionMembers(state, section);
      if (
        origin.source !== null &&
        !sameLanguageExtent(
          state,
          languageOwner(state, { languageSource: origin.source }),
          members,
          true,
        )
      )
        fail("Merged language origin left its source");
      covered.push(...members);
    }
    if (JSON.stringify(covered) !== JSON.stringify(ids))
      fail("Merged language origins do not cover selected text exactly");
  }
  if (intent.edges.some((id) => !possible.has(id)))
    fail("unavailable conversion edge");
}
// Group equal formatting values; do not duplicate text or whole paragraphs in
// the review. The existing format reducer owns clearing and its Undo entries.
export function conversionLoss(state, intent) {
  if (intent.target !== "code") return [];
  const losses = new Map(),
    seen = new Set(),
    projection = conversionProjection(state, intent),
    spans = retainedSourceSpans(state, projection),
    contents = new Map();
  for (const id of contributionMembers(state, intent)) {
    const span = spans.get(id);
    if (!span) fail("Missing retained text source");
    if (!contents.has(span.block))
      contents.set(span.block, text(state, span.block));
    for (const atom of contents.get(span.block).slice(span.from, span.to)) {
      if (seen.has(atom.id)) continue;
      seen.add(atom.id);
      for (const value of atom.marks) {
        const property = propertyOf(value);
        const key = JSON.stringify([property, value]);
        if (!losses.has(key)) losses.set(key, { property, value, ids: [] });
        losses.get(key).ids.push(atom.id);
      }
    }
  }
  return [...losses.values()]
    .map(({ ids, ...entry }) => ({
      ...entry,
      ...compactIdentities(ids.sort(), { unordered: true }),
    }))
    .sort((a, b) =>
      JSON.stringify([a.property, a.value]) <
      JSON.stringify([b.property, b.value])
        ? -1
        : JSON.stringify([a.property, a.value]) >
            JSON.stringify([b.property, b.value])
          ? 1
          : 0,
    );
}
export function validateConversionReview(state, intent) {
  validateConversion(state, intent);
  if (
    JSON.stringify(conversionLoss(state, intent)) !==
    JSON.stringify(intent.loss || [])
  )
    fail(
      "Formatting changed or loss was not reviewed; review conversion again",
    );
}
export function executeConversion(
  state,
  intent,
  action,
  { write, execute, listGroup, numbering, fail: reject = fail },
) {
  const entries = ledger(state),
    adding = intent.kind === "textConvert";
  if (adding && hasBasis(intent))
    listGroup = intent.bases
      ? action
      : entries.find((e) => e.id === intent.basis)?.listGroup;
  if (adding) validateConversionReview(state, intent);
  const previous = entries.find(
    (e) => e.id === (adding ? action : intent.target),
  );
  if (adding ? previous : !previous) fail("contribution missing or reused");
  if (!adding && sourceRecordRetired(state,previous)) throw reject("Restore retired source content before changing its presentation");
  const inverses = [];
  if (adding) {
    // The conversion depends on exactly these exterior cuts. Reuse the engine's
    // existing ownership/retention invariant instead of forbidding peer Undo.
    const fences = new Map();
    for (const w of intent.windows) {
      const f = sourceFamily(state, w.source);
      for (const boundary of [w.left, w.right])
        if (boundary !== null) fences.set(boundary, f.id);
    }
    for (const [boundary, family] of fences)
      inverses.push(
        execute(
          { kind: "listHold", family, boundary },
          `${action}:hold:${inverses.length}`,
        ),
      );
  }
  if (adding) {
    for (const [index, loss] of (intent.loss || []).entries())
      inverses.push(
        execute(
          {
            kind: "format",
            ids: loss.ids || [...identities(loss.idSpans)],
            property: loss.property,
            value: null,
          },
          `${action}:clear:${index}`,
        ),
      );
  }
  // The receipt/effect retains the review and format Undo. Presentation metadata
  // needs only source identities, not another duplicate of every marked ID.
  const { loss, ...structure } = intent;
  const next = adding
    ? [
        ...entries,
        {
          ...structuredClone(structure),
          ...(listGroup ? { listGroup } : {}),
          ...(numbering ? { numbering: structuredClone(numbering) } : {}),
          id: action,
          active: true,
        },
      ]
    : entries.map((e) =>
        e.id === intent.target ? { ...e, active: intent.active } : e,
      );
  write("nodes")[state.root] = {
    ...state.nodes[state.root],
    textConversions: next,
  };
  const inverse = {
    kind: "textConversionActive",
    target: adding ? action : intent.target,
    active: adding ? false : previous.active,
  };
  return inverses.length
    ? { kind: "batch", intents: [inverse, ...inverses.reverse()] }
    : inverse;
}
export function validateConversions(state) {
  validateDisplayLedger(state);
  const ids = new Set();
  for (const e of ledger(state)) {
    if (
      !keys(e, [
        "kind",
        "parent",
        "target",
        "windows",
        "edges",
        "id",
        "active",
        "codeLanguages",
        "language",
        "scope",
        "origins",
        "listGroup",
        "numbering",
        "basis",
        "bases",
        "languageSource",
        "languageOrigins",
      ]) ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      typeof e.active !== "boolean"
    )
      fail("invalid stored contribution");
    ids.add(e.id);
    const {
      id,
      active,
      codeLanguages,
      language,
      listGroup,
      numbering,
      ...intent
    } = e;
    if (e.scope && typeof listGroup !== "string")
      fail("Missing list conversion group");
    // Validate shape and retained source for inactive records too. Active shape
    // conflicts intentionally reject atomically in this feasibility candidate.
    if (active && !sourceRecordRetired(state,e)) validateConversion(state, intent);
  }
  for (const e of ledger(state).filter((e) => e.numbering && !sourceRecordRetired(state,e))) {
    const windows = ledger(state)
      .filter((p) => p.listGroup === e.listGroup)
      .flatMap((p) => p.windows);
    validateConversionNumbering(state, e.scope, e.numbering, windows);
  }
  for (const parent of new Set(
    ledger(state)
      .filter((e) => e.active && !sourceRecordRetired(state,e) && originScopes(e).length)
      .map((e) => e.parent),
  ))
    conversionLayout(state, parent);
}
export function conversionLayout(state, parent) {
  const rawChildren = state.nodes[parent]?.children;
  if (!rawChildren) fail("missing container");
  const active = ledger(state).filter((e) => e.active && !sourceRecordRetired(state,e) && e.parent === parent);
  const scopes = new Set(active.flatMap(originScopes));
  const projected = proseProjectionSources(state, parent);
  for (const scope of scopes)
    for (const [id, owner] of scopeProjection(state, parent, scope).owner)
      projected.owner.set(id, owner);
  const effects = active.map((e) => ({
    ...e,
    rawMembers: new Set(contributionMembers(state, e)),
    members: new Set(
      contributionMembers(state, e).map((id) => projected.owner.get(id)),
    ),
  }));
  const virtual = new Map();
  const children = rawChildren.flatMap((id) => {
    if (!scopes.has(id)) return [id];
    const groupMap = new Map();
    for (const e of effects.filter((e) => originScopes(e).includes(id))) {
      for (const basis of originalBases(state, e).filter(
        (b) => b.scope === id,
      )) {
        const key = basis.listGroup;
        if (!groupMap.has(key))
          groupMap.set(key, {
            id: key,
            members: new Set(),
            rawMembers: new Set(),
            rank: Infinity,
            numbering: null,
            retainItem: false,
          });
        const group = groupMap.get(key);
        group.retainItem ||= hasBasis(e);
        const owned = new Set(contributionMembers(state, basis));
        const sourceOrder = scopeProjection(state, parent, id).children;
        for (const member of e.rawMembers)
          if (owned.has(member)) {
            group.rawMembers.add(member);
            group.members.add(projected.owner.get(member));
            group.rank = Math.min(group.rank, sourceOrder.indexOf(member));
          }
        group.numbering ||=
          basis.numbering ||
          ledger(state).find((p) => p.listGroup === key && p.numbering)
            ?.numbering;
      }
    }
    const groups = [...groupMap.values()].sort((a, b) => a.rank - b.rank);
    for (const [i, group] of groups.entries())
      if (
        groups
          .slice(i + 1)
          .some((other) =>
            [...group.rawMembers].some((member) =>
              other.rawMembers.has(member),
            ),
          )
      )
        fail("Overlapping original conversion sources");
    if (groups.some((g) => !g.numbering))
      fail("Missing active conversion numbering basis");
    for (const group of groups) {
      if (group.retainItem)
        group.members = retainedItemMembers(state, id, group.members);
      if (!effects.some((e) => e.listGroup === group.id && !hasBasis(e)))
        group.numbering = retainedNumbering(
          state,
          group.numbering,
          group.members,
          projected.owner,
        );
    }
    return projectListScope(state, parent, id, groups).map((n) => {
      if (typeof n === "string") return n;
      virtual.set(n.id, n);
      return n.id;
    });
  });
  const kind = (id) =>
    effects.findLast((e) => e.members.has(id))?.target ??
    (virtual.get(id) || state.nodes[id]).type;
  const nativeCodeFamily = (id) => {
    const f = familyFor(state, id);
    return f?.textType === "code" ? f.id : null;
  };
  const result = [];
  for (let i = 0; i < children.length; i++) {
    const id = children[i],
      type = kind(id),
      before = i ? boundaryBefore(state, id) : null,
      previous = children[i - 1],
      winner = effects.findLast((e) => e.members.has(id)),
      previousWinner = effects.findLast((e) => e.members.has(previous));
    const join =
      i &&
      type === kind(previous) &&
      (effects.some(
        (e) =>
          e === winner &&
          e === previousWinner &&
          e.members.has(id) &&
          e.members.has(previous) &&
          e.target === type &&
          (type === "code" || e.edges.includes(before)),
      ) ||
        (type === "code" &&
          !winner &&
          !previousWinner &&
          nativeCodeFamily(id) &&
          nativeCodeFamily(id) === nativeCodeFamily(previous)));
    if (join) {
      const group = result.at(-1);
      group.blocks.push(id);
      group.boundaries.push({ id: before, right: id });
    } else {
      const chosen = effects.findLast((e) => e.members.has(id));
      result.push({
        id,
        type,
        blocks: [id],
        boundaries: [],
        ...(!rawChildren.includes(id) && !virtual.has(id)
          ? { projectedParent: true }
          : {}),
        ...(virtual.has(id) ? { node: virtual.get(id) } : {}),
        ...(type === "code" && chosen?.target === "code"
          ? { conversion: chosen.id }
          : {}),
      });
    }
  }
  return projectDisplayJoins(state, parent, result);
}
export function conversionTokens(state, group) {
  if (!["paragraph", "code"].includes(group.type)) return [];
  const tokens = [];
  for (const [i, id] of group.blocks.entries()) {
    if (i && !group.boundaries[i - 1]?.hidden)
      tokens.push({
        ...group.boundaries[i - 1],
        char: "\n",
        marks: [],
        boundary: true,
      });
    if (["paragraph", "code"].includes(state.nodes[id].type))
      for (const atom of text(state, id))
        tokens.push({
          ...atom,
          source: id,
        });
  }
  return tokens;
}
export function conversionView(state, parent) {
  return conversionLayout(state, parent).map((group) => {
    const tokens = conversionTokens(state, group);
    return { ...group, tokens, text: tokens.map((a) => a.char).join("") };
  });
}

// A captured Body Enter on a native code source needs a retained conversion
// witness. It stays valid if that conversion is undone before delivery.
export function validateLogicalEnter(state, intent) {
  if (
    !keys(intent, ["kind", "at", "conversion"]) ||
    intent.kind !== "logicalEnter" ||
    typeof intent.conversion !== "string"
  )
    fail("invalid logical Enter");
  const entry = ledger(state).find(
    (e) => e.id === intent.conversion && e.target === "paragraph",
  );
  const point = resolveGap(state, intent.at);
  if (!entry || !contributionMembers(state, entry).includes(point.block))
    fail("Body Enter has no conversion witness");
}
export function bodyConversionFor(state, block) {
  return ledger(state).findLast(
    (e) => e.active && !sourceRecordRetired(state,e) && contributionMembers(state, e).includes(block),
  );
}

// Metadata addresses a retained conversion, not its current visible partition.
// Undo may release its boundary while a language message is still in flight.
// Membership therefore uses the retained cut order (including inactive cuts);
// the source must still belong to the original live container.
export function conversionCodeRecord(state, id, block) {
  const entry = ledger(state).find((e) => e.id === id && e.target === "code");
  if (!entry) fail("unknown code conversion");
  if (!retainedConversionContains(state, entry, block))
    fail("code language source left its conversion");
  return entry;
}
function retainedConversionContains(state, entry, block) {
  const parent = state.nodes[entry.parent];
  if (!parent?.live) return false;
  const projected = conversionProjection(state, entry);
  const contains = entry.windows.some((extent) => {
    if (!projected.owner.has(extent.source)) return false;
    const family = sourceFamily(state, extent.source);
    if (!family) return block === extent.source;
    const cuts = family.order.filter((key) => key !== "home");
    const blocks = [
      family.source,
      ...cuts.map((key) => family.cuts[key].block),
    ];
    const start = extent.left === null ? 0 : cuts.indexOf(extent.left) + 1;
    const end =
      extent.right === null ? blocks.length : cuts.indexOf(extent.right) + 1;
    const index = blocks.indexOf(block);
    return index >= start && index < end;
  });
  return contains;
}

export function captureListConversion(state, parent, scope, { items } = {}) {
  const leaves =
    items === undefined
      ? listScopeLeaves(state, parent, scope)
      : captureListItems(state, parent, scope, items);
  const parts = listScopeSections(state, parent, scope, leaves).map(
    (blocks) => {
      const intent = captureConversion(state, parent, blocks, "code", scope),
        loss = conversionLoss(state, intent);
      return { ...intent, ...(loss.length ? { loss } : {}) };
    },
  );
  if (!parts.length) fail("Select list text");
  return {
    kind: "listCodeConvert",
    parent,
    scope,
    parts,
    numbering: captureConversionNumbering(
      state,
      scope,
      items ?? state.nodes[scope].children,
      windowFor,
    ),
    ...(items === undefined ? {} : { partial: true }),
  };
}
export function validateListConversion(state, intent) {
  if (
    !keys(intent, [
      "kind",
      "parent",
      "scope",
      "parts",
      "partial",
      "numbering",
    ]) ||
    intent.kind !== "listCodeConvert" ||
    (intent.partial !== undefined && intent.partial !== true) ||
    typeof intent.parent !== "string" ||
    typeof intent.scope !== "string" ||
    !Array.isArray(intent.parts) ||
    !intent.parts.length
  )
    fail("Invalid list conversion");
  const projected = scopeProjection(state, intent.parent, intent.scope);
  validateConversionNumbering(
    state,
    intent.scope,
    intent.numbering,
    intent.parts.flatMap((p) => p.windows || []),
    { review: true },
  );
  for (const part of intent.parts) validateConversionReview(state, part);
  const selected = new Set(
    intent.parts
      .flatMap((part) => contributionMembers(state, part))
      .map((id) => projected.owner.get(id)),
  );
  const leaves = intent.partial
    ? selectedListLeaves(state, intent.parent, intent.scope, selected).leaves
    : listScopeLeaves(state, intent.parent, intent.scope);
  const sections = listScopeSections(
    state,
    intent.parent,
    intent.scope,
    leaves,
  );
  if (sections.length !== intent.parts.length)
    fail("List media sections changed; review conversion again");
  for (const [i, part] of intent.parts.entries()) {
    if (
      part.parent !== intent.parent ||
      part.scope !== intent.scope ||
      part.target !== "code"
    )
      fail("List conversion source mismatch");
    validateConversionReview(state, part);
    if (
      JSON.stringify(contributionMembers(state, part)) !==
      JSON.stringify(
        sections[i].flatMap((id) => projected.sources.get(id) || [id]),
      )
    )
      fail("List selection changed; review conversion again");
  }
}
export function executeListConversion(state, intent, action, host) {
  validateListConversion(state, intent);
  const inverses = intent.parts.map((part, i) =>
    executeConversion(state, part, `${action}:section:${i}`, {
      ...host,
      listGroup: action,
      numbering: i === 0 ? intent.numbering : undefined,
    }),
  );
  return { kind: "batch", intents: inverses.reverse() };
}

export function conversionSourceScope(state, id) {
  const entry = ledger(state).find((e) => e.id === id);
  if (!entry || !["code","paragraph"].includes(entry.target) || sourceRecordRetired(state,entry))
    fail("Unknown or retired text selection");
  return { entry, sources: contributionMembers(state, entry) };
}

// A follow-up style owns presentation only. It shares the original list group
// and its retained source windows; it does not recreate/outdent stored nodes.
export function captureScopedStyle(state, parent, blocks, target) {
  const candidates = ledger(state).filter(
    (e) => e.active && !sourceRecordRetired(state,e) && originScopes(e).length && e.parent === parent,
  );
  if (!candidates.length) return null;
  const layout = conversionLayout(state, parent),
    selected = layout.filter((g) => g.blocks.some((id) => blocks.includes(id)));
  if (
    !selected.length ||
    selected.some((g) => !["paragraph", "code"].includes(g.type)) ||
    JSON.stringify(selected.flatMap((g) => g.blocks)) !==
      JSON.stringify(blocks) ||
    (selected.length > 1 &&
      (target !== "code" || selected.some((g) => g.type !== "paragraph")))
  )
    fail("Select complete converted sections with compatible text styles");
  const scopes = [...new Set(candidates.flatMap(originScopes))];
  const projection = conversionProjection(state, {
    parent,
    origins: scopes.map((scope) => ({ scope })),
  });
  const sources = blocks.flatMap((id) => projection.sources.get(id) || [id]);
  const roots = new Set(),
    contexts = new Map();
  let hasScoped = false;
  for (const id of sources) {
    const winner = candidates.findLast((e) =>
      contributionMembers(state, e).includes(id),
    );
    let scope = null;
    if (winner) {
      const basis = originalBases(state, winner).find((e) =>
        contributionMembers(state, e).includes(id),
      );
      if (basis) {
        roots.add(basis);
        scope = basis.scope;
        hasScoped = true;
      }
    }
    if (!scope && !proseProjectionSources(state, parent).owner.has(id))
      fail("Selected source has no retained conversion owner");
    if (!contexts.has(scope)) contexts.set(scope, new Set());
    contexts.get(scope).add(windowFor(state, id).source);
  }
  if (!hasScoped) return null;
  const ordered = ledger(state).filter((e) => roots.has(e));
  if (contexts.size === 1 && !contexts.has(null))
    return captureConversion(
      state,
      parent,
      blocks,
      target,
      ordered[0].scope,
      ordered.length === 1 ? ordered[0].id : ordered.map((e) => e.id),
    );
  const origins = [...contexts].map(([scope, sources]) => ({
    scope,
    sources: [...sources],
  }));
  return captureConversion(
    state,
    parent,
    blocks,
    target,
    null,
    ordered.map((e) => e.id),
    origins,
  );
}

// Retained Body ownership authorizes a prose partition in an attached suffix.
// Validation also recognizes the inactive record so Undo retains the source.
export function retainedScopedBody(state, block) {
  return ledger(state).some(
    (e) =>
      originScopes(e).length &&
      hasBasis(e) &&
      e.target === "paragraph" &&
      retainedConversionContains(state, e, block),
  );
}

// Whole-block round trips share the original owned language history, rather
// than cloning a peer's choice into a new, independently undoable default.
export function languageOwner(state, record) {
  const seen = new Set();
  while (record.languageSource) {
    const ref = record.languageSource;
    if (
      !keys(ref, ["kind", "id"]) ||
      typeof ref.id !== "string" ||
      !["block", "conversion"].includes(ref.kind)
    )
      fail("Invalid language source");
    const key = ref.kind + ":" + ref.id;
    if (seen.has(key)) fail("Cyclic language source");
    seen.add(key);
    record =
      ref.kind === "block"
        ? state.nodes[ref.id]
        : ledger(state).find((e) => e.id === ref.id);
    if (
      !record ||
      (ref.kind === "block" ? record.type !== "code" : record.target !== "code")
    )
      fail("Missing language source");
  }
  return record;
}
function sameLanguageExtent(state, owner, ids, subset = false) {
  let source;
  if (owner.kind === "textConvert") source = contributionMembers(state, owner);
  else {
    const family = familyFor(state, owner.id);
    source = family?.source === owner.id ? family.layout.blocks : [owner.id];
  }
  return subset
    ? ids.every((id) => source.includes(id))
    : source.length === ids.length && source.every((id) => ids.includes(id));
}
function rememberedLanguageSource(state, parent, blocks, subset = false) {
  for (const entry of [...ledger(state)].reverse()) {
    if (entry.target !== "code" || entry.parent !== parent) continue;
    // An undone, released exterior fence no longer describes this whole block.
    let matches;
    try {
      matches = sameLanguageExtent(state, entry, blocks, subset);
    } catch {
      continue;
    }
    if (!matches) continue;
    const owner = languageOwner(state, entry);
    if (sameLanguageExtent(state, owner, blocks, subset))
      return {
        kind: owner.kind === "textConvert" ? "conversion" : "block",
        id: owner.id,
      };
  }
  const native = state.nodes[blocks[0]],
    family = native && familyFor(state, native.id),
    owner = family?.textType === "code" ? state.nodes[family.source] : native;
  if (
    owner?.type === "code" &&
    sameLanguageExtent(state, owner, blocks, subset)
  )
    return { kind: "block", id: owner.id };
  return null;
}

function rememberedLanguageOrigins(
  state,
  parent,
  blocks,
  scope,
  basis,
  contexts,
) {
  const groups = conversionLayout(state, parent).filter((g) =>
    g.blocks.some((id) => blocks.includes(id)),
  );
  if (
    groups.length < 1 ||
    groups.some(
      (g) =>
        g.type !== "paragraph" || g.blocks.some((id) => !blocks.includes(id)),
    )
  )
    return null;
  const origins = groups.map((g) => ({
    windows: captureConversion(
      state,
      parent,
      g.blocks,
      "paragraph",
      scope,
      basis,
      contexts,
    ).windows,
    source: rememberedLanguageSource(state, parent, g.blocks, true),
  }));
  return origins.some((o) => o.source !== null) ? origins : null;
}

// Display joins cannot spread a block-scoped style into another source. A
// deleted separator stays independently owned while incompatible styles retain
// their display boundary. Body styles can agree without sharing Undo owners;
// independent code conversions retain their explicitly separate code blocks.
export function conversionJoinCompatible(state, left, right) {
  const entries = ledger(state).filter((e) => e.active && !sourceRecordRetired(state,e));
  const sourceOwners = new Map([
    [left, left],
    [right, right],
  ]);
  for (const parent of new Set(entries.map((e) => e.parent))) {
    for (const [id, owner] of proseProjectionSources(state, parent).owner)
      sourceOwners.set(id, owner);
    for (const scope of new Set(
      entries.filter((e) => e.parent === parent).flatMap(originScopes),
    ))
      for (const [id, owner] of scopeProjection(state, parent, scope).owner)
        sourceOwners.set(id, owner);
  }
  const effects = entries.map((e) => ({
    ...e,
    members: new Set(contributionMembers(state, e)),
  }));
  const styles = [...sourceOwners]
    .filter(([, owner]) => owner === left || owner === right)
    .map(([id]) => {
      const winner = effects.findLast((e) => e.members.has(id));
      return {
        type: winner?.target || state.nodes[id]?.type,
        owner:
          winner?.id ||
          (state.nodes[id]?.type === "code"
            ? familyFor(state, id)?.source || id
            : null),
      };
    });
  return (
    styles.every((s) => s.type === styles[0].type) &&
    (styles[0].type !== "code" ||
      styles.every((s) => s.owner === styles[0].owner))
  );
}
