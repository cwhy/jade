// SPDX-License-Identifier: MPL-2.0
// Lossless references to immutable backing characters. Ordered consumers keep
// their order; set-valued consumers may sort before compacting.
export function compactIdentities(ids, { unordered = false } = {}) {
  if (ids.length < 16) return { ids };
  const parsed = [];
  for (const id of ids) {
    const colon = id.lastIndexOf(":"),
      run = id.slice(0, colon),
      from = Number(id.slice(colon + 1));
    if (
      colon < 1 ||
      !Number.isSafeInteger(from) ||
      from < 0 ||
      String(from) !== id.slice(colon + 1)
    )
      return { ids };
    parsed.push({ run, from });
  }
  if (unordered)
    parsed.sort((a, b) =>
      a.run === b.run ? a.from - b.from : a.run < b.run ? -1 : 1,
    );
  const idSpans = [];
  for (const { run, from } of parsed) {
    const last = idSpans.at(-1);
    if (last?.run === run && last.from + last.length === from) last.length++;
    else idSpans.push({ run, from, length: 1 });
  }
  return JSON.stringify(idSpans).length < JSON.stringify(ids).length
    ? { idSpans }
    : { ids };
}
export function validateIdentitySpans(state, spans, { unique = false } = {}) {
  if (!Array.isArray(spans) || !spans.length)
    throw Error("Invalid stored identity spans");
  if (unique) {
    const sorted = [...spans].sort(
      (a, b) =>
        String(a?.run).localeCompare(String(b?.run)) || a?.from - b?.from,
    );
    for (let i = 1; i < sorted.length; i++)
      if (
        sorted[i - 1]?.run === sorted[i]?.run &&
        sorted[i - 1].from + sorted[i - 1].length > sorted[i].from
      )
        throw Error("Repeated formatting identities");
  }
  for (const p of spans)
    if (
      !p ||
      Object.keys(p).sort().join(",") !== "from,length,run" ||
      !Number.isSafeInteger(p.from) ||
      p.from < 0 ||
      !Number.isSafeInteger(p.length) ||
      p.length < 1 ||
      !state.runs[p.run] ||
      p.from + p.length > state.runs[p.run].chars.length
    )
      throw Error("Invalid stored identity span");
}
