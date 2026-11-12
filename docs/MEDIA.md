# Shared image upload lifecycle (alpha.5)

This is the engine foundation for uploads, not a file-upload service or a complete
image UI. The host remains responsible for identity, access, file validation,
private object storage, serving assets, progress, retries and cleanup.

## Content and upload state

`planInsertBlock(state, range, op, {type: "image", slot, width, height})` inserts
one shared image placeholder at the end of a paragraph in a document, cell or
list item. Alpha.5 also accepts a caret or a text selection within one body/cell
paragraph: one atomic `imagePlace` command erases only the captured characters,
splits the surviving paragraph, and inserts the image before its suffix. `slot` is a unique 16–80 character identifier; dimensions are integers
from 1 through 10,000. Selections spanning paragraphs, middle-of-list-item placement and multi-image
paste remain guarded. Existing end-of-list-paragraph insertion is unchanged.

The image keeps a stable node ID (`op.id + ":image"`) and `mediaSlot`. The
separate `state.pendingMedia[imageId] = {generation}` ledger controls whether
an upload may complete. It contains no file bytes, preview URL, credentials or
per-device progress. Those belong to the host's local upload manager.

Keeping generation outside the node is intentional: table/cell deletion retains
exact content snapshots for Undo. Upload invalidation must not mutate those
snapshots or require exceptions in each structural Undo implementation.

After every engine transition, a live-to-dead unresolved image gets a null
generation. Restoring it assigns the restoring operation's ID as a fresh
generation. Moving it without deleting it retains the current generation.
The sparse pending ledger is traversed for this transition; completed images
are removed from it. Retired unresolved entries remain to fence old requests
and support restoration.

## Completion and authority

After it has durably stored and validated the bytes, the host submits a normal
ordered engine operation with this intent:

```js
{
  kind: "imageComplete",
  image: imageId,
  generation: currentGeneration,
  asset: sha256Hex,
  mime: "image/png",
  bytes: byteLength,
  width: pixelWidth,
  height: pixelHeight
}
```

The engine accepts PNG, JPEG, WebP or GIF descriptors, 1–20 MiB of bytes and
1–10,000 pixel dimensions. Descriptor validation does not inspect image bytes.
The host must verify the actual format and dimensions, asset ownership and
current document edit permission. It must reject client-supplied `imageComplete`
operations at every HTTP/WebSocket mutation ingress. The pure engine has no
account authorization service and deliberately does not pretend to prove
storage durability.

Completion validates the operation epoch and current live slot generation,
then fills the existing node. It never creates a replacement node. A completion
is a system effect; it is not an independent user Undo entry. Retries must keep
the same operation identity and immutable payload and use the normal durable
receipt protocol. After an uncertain result, reconcile that identity rather
than inventing a new completion.

## Delete, Undo and restoration

`{kind: "imageDelete", image: imageId}` deletes a managed image. Undo of the
original insertion removes the pending or completed image. Redo of completed
media restores its asset reference. Redo of unresolved media allocates a fresh
generation, requiring a new upload attempt/reselection if local bytes are gone.

The same invalidation rule applies to clearing a cell and deleting a containing
row, column or table, including repeated Undo/Redo. A delayed completion from
any older generation is rejected. Historical snapshots remain unchanged.

Direct image Undo currently checks that the image is still in its original
parent and that its image-presence ownership has not changed. Broader dependent
move/paste ownership semantics must be qualified before exposing those image
commands in the product. Resize, caption, replacement, rich-paste upload slots,
export and copy-with-assets remain separate work.

Normal grid copying rejects unresolved images. A destructive-operation preview
can display `[Image upload pending]` without turning the placeholder into a
transferable image. Normal copy/export completion must still require all assets.

## Compatibility and evidence

Alpha.5 uses wire 46. Codec 43 records without the optional `pendingMedia` map
remain readable. Wire 43/44/45 journals preserve immutable pending payloads on
one-way upgrade. Hosts must fence older clients before delivering new media
operations or checkpoints; do not downgrade a room that contains these records.

`contracts/media-lifecycle.test.mjs` covers shared insertion, completion,
original-insert Undo, generation invalidation, both completion/deletion orders,
duplicate delivery, reload/replay, malformed descriptors/ledgers, peer text,
structural deletion/clear and repeated restoration. These tests do not prove
real file durability, browser rendering, access revocation or native clipboard
upload behavior; those require host integration tests.

## Atomic placement and owned restoration

The public controller accepts `captureInsertion({allowRange: true})` for image
UI; the default remains a collapsed caret for existing block tools. Preparation
must retain that bookmark and revalidate it before insertion. A changed selection
requires a fresh user choice; it is not silently replaced.

`imagePlace` carries an existing gap, captured character IDs and the upload-slot
descriptor. The authority composes ordinary text-erasure claims, `proseEnter`
partitions and image presence inside one operation. Prefix/suffix characters keep
their identities, marks and anchors. Undo removes the owned image/cut and restores
selected text, preserving concurrent typing and independently owned Enter cuts.
Redo restores the image immediately before its restored suffix, even after a peer
splits the prefix. Completion remains part of the original action for Undo.

Structural conflicts (for example, moving/removing the containing structure)
may still require review; the operation must fail atomically. This command does
not grant upload authority or introduce an alternative asset lifecycle.

`contracts/image-placement.test.mjs` adds 70 schedules covering exact text/marks,
anchors, same-gap images, both arrival orders for typing/Enter, offline erased
text, repeated Undo/Redo, duplicate delivery, reload/replay, generation fencing,
and guarded cross-container/multi-paragraph input. Browser/file transport must
still be qualified by each host.
