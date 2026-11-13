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
