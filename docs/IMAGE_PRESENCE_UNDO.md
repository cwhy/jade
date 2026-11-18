# Image presence, ownership and Undo

Alpha.15 separates two facts that previously shared `imageOwner`:

- The active presence contribution's owner is restored by owned Undo. Deleting
  an image, undoing that deletion, and then undoing the original insertion must
  work; a later live peer contribution must still prevent an earlier Undo.
- `imageGeneration` advances on every direct image presence transition. A drag
  captured before deletion cannot become valid again merely because Undo returns
  the same image to the same position and dimensions.

Internal `imagePresence` inverses retain the previous owner. Their opposite
inverse expects the resulting owner and retains the owner it replaced. The
existing parent, boundary, size-owner and desired-presence checks remain in place.
No public client may submit these internal inverses directly. Image completion
still changes the same slot and is not a separate user Undo action. Pending upload
attempts retain their separate generation fence.

The representation is codec48 / wire54. Codecs43–47 load by cloning and validating
without changing existing IDs, effects, receipts or operation bytes. Older images
use their existing owner as the initial generation fallback. Older inverses that
did not record a previous owner retain their conservative legacy behavior; the
loader does not invent missing ownership history. New presence transitions record
both facts. Old live clients must reload; legacy local journals are retained and
reconciled through the existing atomic load boundary.

The package contracts cover two sequential Undos and Redos, repeated deletion and
restoration through JSON reload, rejection of stale drags, and protection of peer
presence and resize contributions. The app retains the original insertion-Undo
browser assertion after adding a preceding delete/Undo cycle. This is a model
repair, not a special-case rewrite of the browser's Undo stack.

Verification: `verify-zjfnxb`, 38 internal / 3,638 packaged contracts / 93 roots.
Completed copied images do not require an upload slot for deletion. Structural
content comparisons omit generation freshness alone, while still checking logical
presence ownership, asset/presentation and peer changes.
