# Whole-document content boundary

Alpha.14 adds `@cwhy/jade-core/document-content` without changing codec47 or
wire53. It supplies pure body projection/construction for host copy/export jobs.
It is not a document publication, access-control or asset-copy service.

```js
import {captureBodyContent, createBodyContent} from '@cwhy/jade-core/document-content';
const body = captureBodyContent(savedState);
const {state, mapping} = createBodyContent(body, {namespace: newDocumentId});
```

The host chooses one durable source version and a fresh namespace. The capture
returns an immutable version-1 tree containing current body structure, styled
text, literal code text/language, image references/presentation, table geometry
and cell styles. `assets` lists distinct image references in traversal order.
Unresolved images throw `MEDIA_INCOMPLETE`; the host must additionally verify
that the authorized bytes exist and retain them independently for a copy.

This is separate from bounded clipboard fragments. It has no clipboard-sized
64-block/grid limits, and does not normalize CRLF or tabs. It is synchronous;
large-document hosts should run it outside the UI thread and enforce their own
resource/admission limits. This API does not make untrusted arbitrary JSON safe
by itself; malformed structure/marks/attributes are rejected by the engine, but
host request-size and allocation limits remain necessary.

List inheritance is preserved as well as appearance. An item or paragraph may
carry a `marker` baseline containing `base` and/or the final active `override`.
Paragraph-base, item-override and paragraph-override precedence is retained;
implicit markers remain implicit. Active restart numbers become fresh baselines.
Old contribution IDs and inactive style history are omitted. This matters for
Enter before a nested list and for later structural changes.

Construction starts revision 0 / epoch 1 with fresh node, replica, character and
column identities. It returns an old-to-new node mapping for host-owned structured
references. It omits source named fields (including title), effects, deleted
content, receipts, streams, Undo history and contributors. The host supplies a
fresh title and creation history. New edits have ordinary owned Undo; source Undo
cannot target this independently seeded document. Ordinary link URLs are left
unchanged; the API does not guess which external URLs are internal anchors.

Do not persist this tree as an engine checkpoint: it deliberately loses history,
identity and reconciliation state. It is an export/copy interchange boundary.
Normal snapshot persistence must use the engine storage contract. Historical
previews continue to allow unresolved image slots; normal copy/export completion
requires complete media.

The contract tests cover rich cells, new identities/Undo, literal code, inherited
and explicit markers, mixed numbering and restart scopes, geometry/image styles,
missing media, unsafe links and a body larger than clipboard block limits. These
are engine checks, not proof of a host's authorization, cancellation, finalization,
asset retention or rendered export behavior.
