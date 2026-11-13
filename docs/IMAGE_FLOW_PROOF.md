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
  Projection caches store node/family topology, not duplicate character arrays.
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
attachment-bearing destinations, cell/row/table deletion and restoration with
these flows, joins and multi-paragraph replacement, image moves/resizing,
formatting, explicit numbering changes and clipboard operations against
projected wrappers need interaction-specific qualification. Existing contract
passes do not imply those combinations were exercised with the new flow active.
Synthetic projected wrapper IDs must not become unvalidated mutation targets.

Next, qualify the flow alongside structural deletion/recovery and long-document
editing inside its list, add compatibility gates, then test the app's caret,
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

Two new join expectations remain unqualified and are preserved separately in
parent research `image-flow-editing-2026-11-13/join-gate.test.mjs`. Backspace and
forward Delete between two plain suffix paragraphs currently reject with a
prose-context mismatch. Translating the command to a canonical list join alone
is insufficient: join projection retires a paragraph still referenced by image
flow's layout derivation. That attempted adapter was removed. The next change
must define composition/order of join and image projections rather than weaken
boundary validation. These two failures are excluded from the passing release
inventory and explicitly remain an integration gate.
