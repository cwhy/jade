# Image-flow candidate storage upgrade

Alpha.7 source is published on main: codec44 / wire48. The package remains an
experimental alpha; no npm registry publication is implied. It fences image-flow ownership, materialized layout and
shared neighbor witnesses from readers that only understand codec43.

## Load boundary

`@cwhy/jade-core/storage` exports `STORAGE_CODEC` and `upgradeStorage(state)`.
It clones a codec43 or codec44 state, tags the clone codec44, and fully validates
it. Unsupported codecs and malformed states throw without mutating the source.
No character IDs, revision, ownership, operation bytes or receipt decisions change.
Legacy neighbor arrays stay readable; fresh captures use shared chunk references.
There is no downgrade operation after new edits have been accepted.

Room construction, Client initialization and canonical replay upgrade legacy
records at their load boundaries. Current records keep their existing path.
Receipts and stream frontiers are preserved, so a lost-acknowledgement retry still
returns the original decision. Direct core edits reject codec43 rather than
silently migrating during a mutation.

## Local journals

DocumentSession can read wire43–47 journals. It upgrades the checkpoint state,
replays contiguous saved events, rebuilds pending edits without changing their
payloads, then atomically writes the upgraded checkpoint/head before connecting.
The host journal port must replace checkpoint/events/head atomically, as required
by its existing contract. A failed write must retain the previous bytes. Tests
inject a failing write and verify no connection occurs; they do not certify a
particular IndexedDB implementation or a real process crash.

Fresh remote checkpoints must advertise wire48. Unsupported journal versions
fail before any write. Future unknown codecs also fail rather than being retagged.

## Application integration requirements

The protocol exports `requireWireVersion(wire)`. The host must call it on the
connection handshake **before any checkpoint/event payload is sent**, including
connections resumed from hibernation. Wire43–47 and unknown versions require
reload; there is no downgrade or version negotiation. The helper is not a server
and cannot enforce that a host calls it. The private app has not yet been updated.

Upgrade stored records inside the host's transaction/serialized room boundary,
commit the codec44 snapshot before exposing it, and retain the pre-upgrade backup
according to deployment policy. Preserve receipts/frontiers. Fence all old live
connections before new-format data is emitted. An app rollback must not reopen
codec44 data with old package bytes.

## Evidence and limits

The session contracts cover legacy journals with pending work, a saved event plus
pending work, unchanged receipt replay, unsupported input, write failure and
handshake rejection before a mock host delivers data. Full-package verification
also covers the existing image-flow and shared-storage contracts. Actual host
migration, old-browser reload UX, hibernation and application/browser qualification
remain separate gates. This candidate uses alpha.7 package labels to avoid
confusing its artifacts with released alpha.6 bytes.
