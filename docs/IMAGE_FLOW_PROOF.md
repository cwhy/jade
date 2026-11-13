# Image-flow ownership proof — not released

This candidate supersedes the snapshot-inverse approach preserved on
`experiment/list-image-placement`. The original 73 assertions remain intact
(formatting only); all pass, including the two overlapping-image arrival orders
and preservation of a plain paragraph authored after insertion.

## Ownership and projection

- Canonical list boundaries retain character identities and independent Enter
  ownership. `imageFlows` records own an image's layout activity and its cut or
  hold contribution; they do not own a peer's whole tree.
- A second image at an existing image boundary acquires the existing boundary's
  independent hold. Undoing either image cannot remove the other's separation.
- `imageFlowKind` retains a plain Enter's authored paragraph type. An offline
  numbered Enter and an online plain Enter are deliberately different inputs.
- Before relevant mutations, restore the cached canonical topology. Apply the
  semantic edit there, then project images, plain suffixes and ordered runs.
  Projection caches store node topology, not duplicate character arrays. Logical
  boundary families remain canonical beneath that visible layout.
- Validate persisted ownership and reconstruct the projection to verify it
  matches the published view. Raw activity commands remain private to Undo.
- Ordinary insertions outside projected lists and paragraph families reuse the
  projection and node map; a contract asserts this structural sharing.
- Legacy `imageInsert` retains its original item-attachment meaning.

The shared image slot and generation ledger remain the existing media lifecycle.
Completion does not create a replacement image or an extra user Undo action.

## Evidence

The new contract file has 150 passing cases. They include the original 73 plus
different/same-gap image combinations, both arrival/Undo orders, repeated
Undo/Redo, uncertain acknowledgements modeled by exact duplicate delivery,
JSON reload after every event, client replay equality, completion generation
fencing, malformed persisted records, forged private commands, and an unrelated
typing projection-sharing check.

`npm test` passes 31 internal + 3,253 installed-package contracts across 82
contract roots, including the new file in the explicit test inventory. These
counts are not UI or production qualification.

A small local Node probe uses 1,001 paragraphs and 100,000 mock words. After
three warmup edits, 12 measured unrelated insertions show median model time
around 1.12 ms with a flow versus 0.98 ms baseline. Before projection reuse,
the flow median was around 10.12 ms. These are one-process illustrative results,
not a performance budget pass, confidence interval, browser measurement or
cross-region test. Inside-list editing and accumulated-flow costs remain open.

## Release gates still open

This is a committed local experiment, not a new alpha release. Versions remain
at the baseline solely for the proof harness; do not ship these artifacts to
older clients. New ownership/projection fields need an explicit codec/wire
compatibility decision and tested migration before integration. A different
semantic intent alone is not sufficient storage fencing.

The proved shape is a leaf numbered paragraph in a document or cell. Nested or
attachment-bearing destinations, wider deletion/restoration schedules,
transitions across image boundaries and multi-paragraph replacement, image moves/resizing,
formatting, explicit numbering changes and clipboard operations against
projected wrappers need interaction-specific qualification. Existing contract
passes do not imply those combinations were exercised with the new flow active.
Synthetic projected wrapper IDs must not become unvalidated mutation targets.

Bounded container deletion, inside-list typing and plain-suffix joins now have
model evidence in the follow-ups below. Next qualify replacement and other
projected-wrapper commands, add compatibility gates, then test the app's caret,
picker/paste, rendering, and uploads using the packaged candidate. No application
dependency, deployed service, public release or native-input behavior changed
in this proof.

## November 13 follow-up: container deletion/restoration

Projection now recognizes a canonical list retired by cell clear or structural
row/column/table deletion, provided every managed image belonging to that list
is also retired. It retains the ownership ledger without rebuilding the deleted
view. Fully retired paragraph families likewise have no visible projection.
Unexplained missing/moved live scopes still fail instead of being silently ignored.

Added 37 cases: start/middle/end placement under clear/row/column/table removal;
pending and completed uploads; reload/replay and duplicate receipts across
deletion/restoration; stale generation rejection; repeated Undo/Redo; and an
unaffected image flow in another cell. The new file now contains 187 cases.

The existing destructive witness rule remains: completion after restoration
changes the content, so a stale deletion Redo is rejected. A fresh reviewed
deletion can remove it and Undo restores the completed asset. This change does
not relax witness checking or imply that a stale Redo silently deletes new data.

This qualifies these bounded container-retirement schedules. It does not yet
qualify replacement paste, merges/joins, arbitrary moves, projected-wrapper
commands, codec/wire migration, or application/browser integration.

## November 13: typing within the affected list

Visible paragraph insertion now reuses image topology both inside and outside
the affected list. It changes replicas and retained gap positions, not the
cached wrapper layout. Creation-owned/hidden paragraphs and active join
projections conservatively rebuild. Three added contracts verify node-map and
projection identity, reload and Undo for prefix, suffix and another list item.

A local 100,000-word probe (five warmups, 50 measured edits per case) found
prefix/same-list typing medians near 0.7 ms after reuse, versus approximately
10.2 ms before. These are illustrative model-only measurements, not rendered
application or release performance qualification.

At that checkpoint, two join expectations were unqualified and preserved in
parent research `image-flow-editing-2026-11-13/join-gate.test.mjs`. Backspace and
forward Delete between two plain suffix paragraphs rejected with a
prose-context mismatch. Translating the command to a canonical list join alone
is insufficient: join projection retires a paragraph still referenced by image
flow's layout derivation. That attempted adapter was removed. The next change
must define composition/order of join and image projections rather than weaken
boundary validation. Those failures were excluded from that passing inventory. The following
checkpoint includes both unchanged expectations and passes them.


## November 13: plain-suffix joins and logical start tracking

Image layout now leaves canonical paragraph-boundary families untouched. A
visible plain-suffix join uses its retained canonical list cut after suspending
image layout; the ordinary join ledger owns the contribution. Join projection
runs before image layout. The view no longer derives a second family layout
from a paragraph that a join has retired.

The two preserved Backspace/Delete expectations now pass unchanged. Eight new
schedules cover both directions, both peer-typing arrival orders, both image/join
Undo orders, repeated Undo/Redo, marked peer text, original atom anchors, JSON
room reload, exact duplicate decisions and client replay after every event.
The image-placement family now contains 200 passing cases.

These schedules exposed a shared bug: a logical paragraph-start marker can sit
inside a joined visible paragraph. It must move when typing occurs before it;
only insertion exactly at the start retains its right-side affinity. Previously
all start markers stayed fixed. Unjoining could look correct until another
boundary toggle repartitioned the text using the stale marker. Twelve image-free
list/prose cases check exact atoms and marks at start/interior/end positions,
both arrival orders and repeated cut toggles. Four fail under the old rule and
all pass under the corrected invariant.

Installed-package verification: 31 internal + 3,315 contracts across 82 roots
(artifact `verify-hJwMbL`). This is model/package evidence, not browser/native or
production qualification. The image-layout proof still requires version fences
and interaction-specific qualification before application integration. Parent
research `image-flow-joins-2026-11-13` preserves the control and passing logs.


## November 13: replacement across plain suffix paragraphs

Four basic replacement cases cover deletion, one-line replacement, multiline
replacement and a blank line, including the resulting caret and exact restored
atoms. Multiline replacement exposed a guessed paragraph ID: visible prose
can retain a list partition underneath. `paragraphForEnter` now reads the new
paragraph identity from the logical cut. Enter, replacement execution and caret
planning share that source of truth without image-specific naming guesses.

Twenty-four more schedules combine replacements with offline marked text in
either removed paragraph, both arrival orders, both image/replacement Undo
orders, repeated Redo, exact duplicate decisions, JSON room reload and client
replay after every event. Undo restores the peer's text to its original paragraph
and position. The image contract family now has 228 cases. Final packaged
verification passes 31 internal + 3,343 contracts across 82 roots. Counts include
prior coverage; they are not additive release-completion metrics.

This qualifies adjacent plain suffix paragraphs only. Crossing an intervening
image, arbitrary projected-wrapper operations, codec/wire fencing and app/UI
integration remain open. No public release or deployment occurs in this proof.


## November 13: visible copy and formatting

Twelve added cases cover bold, italic, underline, strike, text color and
highlight across the numbered prefix and plain suffix. Both format operations
are planned from the same source, then accepted separately. Both image/author
format Undo orders preserve the peer's overlap, and peer Undo restores the
original marks and atoms.

Four copy cases check unfinished-image transfer rejection while ordinary suffix
text stays copyable; completed whole-cell and text-range copy retain the visible
list/image/prose/list shape and resumed numbering without internal identities,
media generation or image-flow ownership; plain paragraphs remain prose after
join Undo. Copy leaves the source state unchanged. No additional runtime patch
was required for these cases; external OS clipboard and destination paste are
separate qualifications.

Latest installed-package evidence: 31 internal + 3,359 contracts across 82 roots,
including 244 image-placement cases (artifact `verify-NeEv4U`). Runtime is the
join/replacement checkpoint; this follow-up adds tests only. Next qualification
includes destination paste, structural commands and image-delete/resize
combinations before compatibility fencing and application/browser integration.


## November 13: image presence, size ownership and cell paste

The dedicated `image-flow-media-paste.test.mjs` adds 29 cases. Each accepted or
rejected operation is replayed, duplicated exactly, and followed by JSON room
reload and state validation. The schedules cover pending/completed images at
start/middle/end, explicit delete/restore, upload-generation fencing, size
ownership and stale previews, offline marked text, two independently deleted
images sharing a cut, cell replacement and restoration, and detached cell
copies with completed assets and display size.

Four invariants were repaired:

- Explicit image deletion hides the object without changing its retained plain
  suffix into another numbered item. Insertion activity still owns the cut;
  only live images emit visible image events.
- A flow-managed image restores via its own retained scope/cut. Its temporary
  canonical staging neighbor is not a dependency on another image's lifetime.
  Ordinary images keep their existing position witnesses.
- Stale/unavailable resize operations raise admission conflicts, so the room
  stores a rejected decision and advances the sequence instead of throwing an
  unreceipted exception. Retry/replay does not admit a stale write.
- Size Undo checks the exact image, asset, parent, dimensions and size owner.
  Deleting and restoring that image changes presence generation but does not
  replace its size contribution. Public resize previews still require the
  current presence generation; newer peer sizes still block old size Undo.

Cell replacement preserves the existing destructive-review rule. Typing, image
completion or resizing after preview causes rejection without content change.
A newly reviewed paste succeeds and Undo restores those edits. Pasting a copied
cell makes fresh content identities without source flow/media/size ownership;
source deletion cannot remove the destination's completed image reference.
These are same-document engine checks, not cross-document asset authorization.

Packaged verification: 31 internal + 3,388 contracts across 83 roots, artifact
`verify-kNAXLk`. The previous 244 image-placement cases remain included.

Two separate rich-caret cases remain failing in parent research
`image-flow-media-paste-2026-11-13/rich-caret-gate.test.mjs`: pasting code or a
bullet list inside the plain suffix. Rich insertion chooses its grammar from
the canonical list wrapper, despite the visible prose destination; the planner
also infers a tail identity from that mismatch. Preserve these assertions and
resolve rich-insert/image-projection composition before claiming general paste
support. They are explicitly outside the passing package inventory and block
full image-flow integration. No codec/wire fence, app/native qualification or
public release is supplied by this checkpoint.
