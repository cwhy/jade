// SPDX-License-Identifier: MPL-2.0
// A conservative shallow diff, not a claim of O(changes) mutation cost. Sealed
// values can be compared by identity; removals must be included as dependencies.
export function changedKeys(before, after) {
  if (before === after) return [];
  const result = [];
  for (const key of Object.keys(after))
    if (!Object.hasOwn(before, key) || after[key] !== before[key])
      result.push(key);
  for (const key of Object.keys(before))
    if (!Object.hasOwn(after, key)) result.push(key);
  return result;
}
