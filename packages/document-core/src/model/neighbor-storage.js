// SPDX-License-Identifier: MPL-2.0
// Private, lossless storage for Undo placement witnesses. Chunks are immutable;
// retired node IDs remain valid witnesses and are never pruned here.
const invalid = () => Error("Invalid separated paragraph neighbours");
export function readNeighbours(state, value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some(
      (k) => !["version", "preceding", "following"].includes(k),
    ) ||
    !Array.isArray(value.preceding) ||
    !Array.isArray(value.following)
  )
    throw invalid();
  if (value.version === undefined) return value;
  if (value.version !== 1) throw invalid();
  const decode = (refs) =>
    refs.flatMap((id) => {
      if (
        typeof id !== "string" ||
        !Object.hasOwn(state.neighborChunks || {}, id)
      )
        throw invalid();
      const chunk = state.neighborChunks[id];
      if (!Array.isArray(chunk) || !chunk.length || chunk.length > 64)
        throw invalid();
      return chunk;
    });
  return {
    preceding: decode(value.preceding),
    following: decode(value.following),
  };
}
export function storeNeighbours(state, value, write) {
  const index = new Map(
    Object.entries(state.neighborChunks || {}).map(([id, ids]) => [
      JSON.stringify(ids),
      id,
    ]),
  );
  let next = Object.keys(state.neighborChunks || {}).length;
  const encode = (ids) => {
    const refs = [];
    for (let end = ids.length; end > 0; end -= 64) {
      const chunk = ids.slice(Math.max(0, end - 64), end),
        key = JSON.stringify(chunk);
      let id = index.get(key);
      if (id === undefined) {
        do {
          id = `n${next++}`;
        } while (Object.hasOwn(state.neighborChunks || {}, id));
        write("neighborChunks")[id] = chunk;
        index.set(key, id);
      }
      refs.unshift(id);
    }
    return refs;
  };
  return {
    version: 1,
    preceding: encode(value.preceding),
    following: encode(value.following),
  };
}
export function validateNeighborStorage(state) {
  if (state.neighborChunks === undefined) return;
  if (
    !state.neighborChunks ||
    typeof state.neighborChunks !== "object" ||
    Array.isArray(state.neighborChunks)
  )
    throw invalid();
  for (const [key, chunk] of Object.entries(state.neighborChunks)) {
    if (
      !/^n\d+$/.test(key) ||
      !Array.isArray(chunk) ||
      !chunk.length ||
      chunk.length > 64 ||
      chunk.some(
        (id) => typeof id !== "string" || !Object.hasOwn(state.nodes, id),
      ) ||
      new Set(chunk).size !== chunk.length
    )
      throw invalid();
  }
}
