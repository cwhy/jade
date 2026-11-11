// SPDX-License-Identifier: MPL-2.0
// Immutable backing runs + copy-on-write piece descriptors. No CRDT dependency.
// Offsets count Unicode code points, not UTF-16 units or grapheme clusters.
export function lengthOf(pieces) {
  return pieces.reduce((n, p) => n + p.length, 0);
}
export function concatPieces(...lists) {
  const result = [];
  for (const list of lists)
    for (const p of list) {
      if (!p.length) continue;
      const previous = result.at(-1);
      if (previous?.run === p.run && previous.from + previous.length === p.from)
        previous.length += p.length;
      else result.push({ ...p });
    }
  return result;
}
export function slicePieces(pieces, from = 0, to = lengthOf(pieces)) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > lengthOf(pieces)
  )
    throw Error("Invalid piece slice");
  const result = [];
  let offset = 0;
  for (const p of pieces) {
    const start = Math.max(from, offset),
      end = Math.min(to, offset + p.length);
    if (start < end)
      result.push({
        run: p.run,
        from: p.from + start - offset,
        length: end - start,
      });
    offset += p.length;
    if (offset >= to) break;
  }
  return result;
}
function identity(id) {
  const pos = id.lastIndexOf(":"),
    run = id.slice(0, pos),
    at = Number(id.slice(pos + 1));
  if (
    pos < 1 ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    String(at) !== id.slice(pos + 1)
  )
    throw Error("Invalid character identity");
  return { run, at };
}
function markKey(marks) {
  return JSON.stringify(marks);
}
function marksAt(run, offset) {
  const format = run.formats.find(
    (f) => offset >= f.from && offset < f.from + f.length,
  );
  if (!format) throw Error("Missing mark range");
  return format.marks;
}
export function internAtoms(runs, atoms) {
  const groups = [];
  for (const atom of atoms) {
    const { run, at } = identity(atom.id);
    let group = groups.at(-1);
    if (!group || group.run !== run || group.from + group.atoms.length !== at) {
      group = { run, from: at, atoms: [] };
      groups.push(group);
    }
    group.atoms.push(atom);
  }
  for (const group of groups) {
    let run = runs[group.run];
    if (!run) {
      if (group.from !== 0) throw Error("Unknown backing run");
      const formats = [];
      for (const [i, atom] of group.atoms.entries()) {
        if (
          typeof atom.char !== "string" ||
          [...atom.char].length !== 1 ||
          !Array.isArray(atom.marks)
        )
          throw Error("Invalid atom");
        const previous = formats.at(-1);
        if (previous && markKey(previous.marks) === markKey(atom.marks))
          previous.length++;
        else
          formats.push({
            from: i,
            length: 1,
            marks: structuredClone(atom.marks),
          });
      }
      run = { chars: group.atoms.map((a) => a.char), formats };
      runs[group.run] = run;
    } else {
      for (const [i, a] of group.atoms.entries())
        if (
          run.chars[group.from + i] !== a.char ||
          markKey(marksAt(run, group.from + i)) !== markKey(a.marks)
        )
          throw Error("Immutable run identity reused");
    }
  }
  return concatPieces(
    groups.map((g) => ({ run: g.run, from: g.from, length: g.atoms.length })),
  );
}
export function readPieces(runs, pieces) {
  const result = [];
  for (const p of pieces) {
    const run = runs[p.run];
    if (
      !run ||
      !Number.isInteger(p.from) ||
      !Number.isInteger(p.length) ||
      p.from < 0 ||
      p.length < 1 ||
      p.from + p.length > run.chars.length
    )
      throw Error("Invalid backing slice");
    let fi = 0;
    while (run.formats[fi].from + run.formats[fi].length <= p.from) fi++;
    for (let i = p.from; i < p.from + p.length; i++) {
      while (run.formats[fi].from + run.formats[fi].length <= i) fi++;
      result.push({
        id: `${p.run}:${i}`,
        char: run.chars[i],
        marks: run.formats[fi].marks,
      });
    }
  }
  return result;
}
export function* identities(pieces, reverse = false) {
  for (const p of reverse ? pieces.toReversed() : pieces) {
    if (reverse) {
      for (let i = p.from + p.length - 1; i >= p.from; i--)
        yield `${p.run}:${i}`;
    } else {
      for (let i = p.from; i < p.from + p.length; i++) yield `${p.run}:${i}`;
    }
  }
}
export function createReplica(id, owner, pieces, origin) {
  pieces = concatPieces(pieces);
  return {
    id,
    generation: 1,
    owner,
    retired: false,
    origin,
    pieces,
    length: lengthOf(pieces),
  };
}
export function spliceReplica(replica, from, remove, insert = []) {
  const pieces = concatPieces(
    slicePieces(replica.pieces, 0, from),
    insert,
    slicePieces(replica.pieces, from + remove),
  );
  return { ...replica, pieces, length: lengthOf(pieces) };
}
