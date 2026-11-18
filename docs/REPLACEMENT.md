# Named fields and conditional text replacement

Local alpha.11 candidate: codec46 / wire52. This checkpoint is not a claim of
complete editor UX or a published deployment. Current package verification has
36 internal and 3,587 packaged passing checks.

A document root may map field names to live `text_field` nodes. Fields use the
same text identities, formatting-free content, persistence and owned Undo as body
text, but do not appear in body navigation or body range selections. A selection
may remain within one field; it cannot cross a field/body boundary. Host-controlled
`textFieldCreate` initializes a field with an optional immutable single-line length
limit. The host must prevent arbitrary clients from issuing that setup operation.

`@cwhy/jade-core/text-replacement` exports `reviewTextReplacement(state, options)`.
It returns an immutable-operation proposal and plain preview data, without changing
state. Options are literal `query`, `replacement`, `matchCase`, and `scope` (`one`
or `all`). A single target uses `{block, first}` with the first character identity.
`@cwhy/jade-core/literal-search` shares the Unicode/grapheme matching algorithm with
host Find UI. It does not parse regexes, Markdown or markup.

The resulting `textReplace` operation carries the complete reviewed set of backing
piece identities and visible mark runs. Admission revalidates every target before
changing anything. Added, removed, edited or reformatted matches reject a complete-set
review; unrelated edits map through stable identities. Prose inherits the first
character's marks, retaining a link only when it spans the whole match. Fields and
code remain plain. An identical replacement does not create a content revision.

One operation owns all changes. A teammate's insertion inside newly replaced text
moves after the restored source on Undo: Draft → Final → FiXnal → Undo is DraftX.
Redo restores FiXnal. Outside contributions retain their side. `replacementOrigins`
retains source-edge relationships across delivery order, persistence and nested
replacements. This is separate from typing into the removed original text, which
retains its original logical location.

Implementation batches all source deletions into one semantic claim and places
fresh text against still-live identities before deleting the source set. No staged
intermediate state is published. Transaction-scoped ownership and deletion-boundary
indexes avoid repeated whole-document scans; no derived index is persisted or
retained through a document-history chain.

## Large operations and host computation

`Client` accepts optional fifth-argument `{deferMutation(intent, state)}`;
`DocumentSession` accepts the same optional port. When it returns true, prepare
allocates an immutable outbox operation and owned-history entry without applying
it optimistically. `awaitingDecision` remains true until a receipt settles it, and
new mutations are refused during that interval. The visible model retains accepted
content while remote decisions continue to arrive. The host should show progress.

Deferred operation IDs must be persisted with the pending queue (`Client.save()`
and `DocumentSession.head()` include them when nonempty). Reload must not guess an
optimistic application of that queue. Rejection still advances the stream through
its terminal receipt; `acknowledgeRejection(id)` is allowed only with no dependent
work and the exact latest rejected sequence. It cannot clear another rejected branch.

A session replication adapter may return a Promise from `replay`. Session processing
awaits it before accepting later events or Ready, captures the latest caret before
installing the result, and retains the normal journal-before-ack/send ordering.
This lets a host execute the same public replay verifier in a Worker. The host owns
worker creation, failure handling, access checks and progress UI. No unverified server
snapshot is silently substituted for deterministic replay. Small typing can retain
the ordinary synchronous optimistic path.

Codec43/44/45 storage remains readable via explicit clone-and-validate loading; wire43–51
saved journals are readable before connecting with wire52. Live old-wire clients
must be fenced. Unknown metadata is not fabricated. Host fields and restoration
relationships are meaningful schema additions, rather than an application release
or production-data policy.

Paragraph generation retention and private Undo encoding are specified in [STORAGE.md](STORAGE.md).
