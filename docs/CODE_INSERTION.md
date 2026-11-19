# Inserting code below a paragraph

Alpha.20 / wire58 / codec52 makes `planInsertBlock(state, range, op,
{type: "code"})` insert an empty code block immediately after the containing
paragraph. The caret can be at the start, middle or end. The original paragraph
keeps all text, marks and identities. The new block stays in the same document,
cell or list item and the plan's `after` gap focuses its first line.

This is insertion, not sentence conversion or clipboard paste. A non-collapsed
selection is rejected without changing it. Blank source paragraphs remain;
a list item's required first paragraph is never silently removed. Hosts must
implement slash-query consumption, fenced conversion and explicit conversion
separately, with their own reviewed/atomic contracts.

The public semantic operation is `insertCodeBlock` with the existing paragraph
ID. Admission does not accept arbitrary node IDs, parent overrides, replica IDs,
child data or raw tree steps. Creation uses the same adjacent-leaf machinery as
paragraph boundaries, with an explicit code kind. Code does not acquire prose
split/exit behavior. The command creates one code identity and one text replica;
it does not partition the original paragraph or allocate source generations.

An inactive birth stays visible while independent text, code-language choices,
or live adjacent creations require it. Boundary dependencies point to earlier
creations. Projection processes dependents before their prerequisites, with a
cached dependency index. Undo of the final dependent releases an otherwise
unused boundary in the same projection. Redo or a delayed insertion can revive
a certified hidden leaf boundary without replaying its creator's erased text.
Explicit deletion/clear and scope ownership still fence revival. No parallel
placement or Undo ledger is introduced.

The exact alpha.20 package proof passes 38 internal checks and 3,781 contracts
across 98 roots. The 32 new insertion cases cover body/cell/numbered/bullet/nested
placements, intact text identities and marks, empty sources, focus gaps,
concurrent births, peer text/language, dependent continuation Undo/Redo, late
insertion, duplicate receipts, reload/replay and clear-cell fences. Existing
adjacent-paragraph and rich-insertion assertions remain in the proof.

Codec51 and earlier supported records remain readable; wire57 and earlier
supported journals preserve their pending operation bytes and receipt decisions.
Live clients must use wire58. The format change does not prune history.

These checks do not certify all structural moves, conversions, slash menus,
native input platforms, or the host's complete UI. This is an experimental
engine source checkpoint, not an npm registry publication.

## Blank paragraph shortcut

Cmd+Option+C / Ctrl+Alt+C uses the same insertion planner on an empty paragraph.
It retains the empty paragraph and inserts code below in the same body/cell/item.
Nonempty prose, selections, existing code, active composition, Shift variants and
AltGraph do not trigger it. Shortcut recognition accepts physical KeyC for the
Mac Option-generated character. This is distinct from fenced text conversion,
whose prefix-restoring Undo remains a separate implementation.

Alpha.21's exact packages pass the same 38 internal / 3,781 contract suite.
Nineteen installed-controller browser cases qualify the shortcut's body/cell/item
placement, focus, peer-safe Undo and key/context guards. This is headless modifier
coverage, not native Windows/IME certification. The host app maintains those
browser checks as part of its installation qualification.
