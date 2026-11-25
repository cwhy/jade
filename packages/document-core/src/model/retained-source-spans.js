// SPDX-License-Identifier: MPL-2.0
// Physical joins concatenate replicas but retain certified cut markers. Resolve
// historical source spans through those markers, never through matching text.
export function retainedSourceSpans(state, projection) {
  const cuts = new Map(
    state.joinProjection.map((p) => {
      const join = state.listJoins[p.boundary];
      return [join.right, state.boundaries[`projection-cut:${join.id}`]];
    }),
  );
  const result = new Map();
  for (const [block, sources] of projection.sources) {
    const length = state.replicas[state.nodes[block]?.text]?.length;
    if (length === undefined) continue;
    const starts = sources.map((source, index) => {
      if (!index) return 0;
      const cut = cuts.get(source);
      if (
        !cut ||
        cut.block !== block ||
        !Number.isSafeInteger(cut.offset) ||
        cut.offset < 0 ||
        cut.offset > length
      )
        throw Error("Historical source has no certified joined span");
      return cut.offset;
    });
    for (const [index, source] of sources.entries()) {
      const from = starts[index],
        to = starts[index + 1] ?? length;
      if (from > to) throw Error("Historical source span order changed");
      result.set(source, { block, from, to });
    }
  }
  return result;
}
