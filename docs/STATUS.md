## November 19 literal code input candidate

Alpha.16 retains codec48 / wire54. Enter carries authored indentation; literal
code paste normalizes line endings without the paragraph-fragment count limit.
The exact alpha.16 artifact passes 38 internal / 3,660 packaged contracts across
94 roots (`verify-XN3UsN`), plus eight isolated browser scenarios against its
installed external consumer. Application integration/deployment is pending.
See [CODE_INPUT.md](CODE_INPUT.md). No full editor or native IME sign-off is implied.

## November 19 image presence Undo candidate

Alpha.15 uses codec48 / wire54 to separate active image contribution ownership
from lifecycle freshness. Delete → Undo → Undo insertion and both Redos work;
stale drags and peer presence/resize changes remain protected. Completed copied
images also support deletion without an upload slot. The content comparator
ignores freshness alone while retaining ownership guards.

Full verification passes 38 internal / 3,638 packaged contracts across 93 roots
(exact artifact `verify-zjfnxb`). Tests include uncertain delivery, server reload,
legacy source preservation and rich-paste Undo. Application/browser delivery and
full product qualification are separate. See [IMAGE_PRESENCE_UNDO.md](IMAGE_PRESENCE_UNDO.md).

## November 19 whole-document content candidate

Alpha.14 adds captureBodyContent/createBodyContent for host copy/export workflows.
Codec47 and wire53 remain unchanged. Twelve new contracts cover fresh identities,
source-history exclusion, rich cells, literal code, list marker scope/inheritance,
numbering, geometry and incomplete media. Full packaged verification passes
38 internal and 3,630 packaged contracts across 92 roots (`verify-EhxNHZ`).
This does not implement the application Make a copy or export flows. See
[DOCUMENT_CONTENT.md](DOCUMENT_CONTENT.md).

## November 19 decoded host ports candidate

Alpha.13 keeps codec47 / wire53 and adds an optional owned-object handoff for
host-decoded checkpoints and messages, with explicit encoded-byte telemetry.
This avoids serializing a decoded snapshot again solely to enter the session API.
Verification passes 38 internal and 3,618 packaged contracts across 91 roots
(exact artifact `verify-uPciUx`). This is not a snapshot-format or resource qualification.

Alpha.12's restore boundary passed 36 internal / 3,616 packaged contracts across
91 roots (exact artifact verify-c0L5PZ), plus bounded host room/journal/browser
integration. Exact target content, old decision reconciliation, retired/fresh Undo,
rich-cell behavior, unresolved media, lost acknowledgements, offline queues,
transaction rollback and overlapping restores are covered. Native input and large
retained-record reconstruction are separate gates. See [RESTORE.md](RESTORE.md).

## November 19 storage repair (source published; npm packages vendored)

The user approved repairing storage growth before history, copy and export.
Versioned partition preservation and compact private Undo identities now pass
36 internal and 3,601 packaged contracts (`verify-TeCc2o`). Old event replay and pending
multi-operation queues preserve their original generation IDs and payload bytes.

The 100,000-word real-paste model fixture stores 4,074,706 bytes / 1,999 replicas
when appending and 4,481,010 bytes / 2,949 replicas when prepending. Doubling the
content approximately doubles storage. No history or retired identities are
pruned. See [STORAGE.md](STORAGE.md) for invariants and compatibility.

The app now consumes those exact tarballs (codec46 / wire52). Its backend passes
240 checks; 13 Find, 12 Replace and 26 live browser scenarios also pass.
The full 100,000-word browser run passes: Replace All 2.72s, Undo 2.02s and Redo
2.54s; maximum animation-frame gaps 100/83/83ms respectively. These are one
local Chrome sample, not remote hosting or Windows qualification. No deployment
is claimed. Root project evidence remains
`research/replacement-scale-2026-11-19/`.

# Alpha.11 source checkpoint — November 19, 2026

Named text fields, reviewed conditional replacement and replacement-origin Undo
are implemented. The current package run passes 36 internal and 3,601 contracts.
Wire52 / codec46 are required for new writes; old saved journals have an explicit
read path. Large-operation deferral preserves immutable outbox bytes and history;
replication adapters may perform replay asynchronously while ordered admission,
receipt reconciliation and journal durability remain in Jade.

The host application is qualifying progress responsiveness and bounded compressed
transport. The standalone model's 100,000-word / 10,000-match sample completes with
exact content in about four seconds after profile-guided changes. That is a local
single-run measurement, not a cross-browser performance guarantee. A responsive
host must keep the expensive replay off the UI thread. Full history/copy/export
remain application responsibilities. See [REPLACEMENT.md](REPLACEMENT.md).

Source checkpoint `5c75370ee6b868c0420d148c615de2bb3563b1e0` is pushed to main.
Node 22/24 engine CI and the website/demo CI passed. Packages are vendored
into the host application; no npm registry release is claimed. Prior checkpoints follow.

# Alpha.10 checkpoint — November 15, 2026

The prepared-paste host API accepts explicit `text/plain` strings through ordinary
replacement, including code-block carets. Newlines remain inside code; markup is
literal and marks are not inherited. Host authentication and review remain outside
the engine. Wire50 and codec44 are unchanged.

31 internal checks and 3,559 packaged contracts pass. Browser qualification of the
new host path is tracked in the consuming application's reviewed-recovery tests;
the standalone contract count does not include browser interaction tests.

# Alpha.9 checkpoint — November 14, 2026

Pending media can be part of one rich paste in document bodies, rich cells and
supported image-bearing list items. Completion preserves owned Undo; stale
reviewed replacement remains protected. A later image resize prevents destructive
Undo of an attached pasted item, including release of its last placement hold.
31 internal and 3,559 packaged checks pass. Protocol advances to wire50 with
codec44 unchanged; journals from wire43–49 can upgrade before connecting.

The host still authorizes and stores bytes. The standalone suite does not certify
its import UI, permission routing or cloud deployment. Pending image Fill into
multiple cells is not enabled. The browser host entry points preserve normal
cell review, do not accept raw DOM mutations and call onCommit only after insertion.

# Status and limitations

jade is an alpha implementation, not a complete editor product or a stable storage-format promise.

## Reproducible coverage

The standalone suite contains 31 internal checks and 3,103 public-contract checks across 81 roots. It exercises text/formatting, rich lists and tables, identity/anchor behavior, owned Undo, client/replay contracts and selected persistence schedules.

`npm test` uses real tarballs in an independent consumer rather than workspace symlinks. Run it to verify the current revision. Counts describe a bounded corpus, not a completion percentage.

Application-dependent browser, native-input, transport and deployment checks are not bundled here. The external-test inventory in `verification/test-scope.json` documents that boundary; those tests are not included in the standalone count. Earlier development measurements do not certify another host application or a later build.

## Still being qualified

- Complete image, selection/move, keyboard and structural-command combinations.
- External/native clipboard fidelity and cross-document asset handling.
- Remaining Find/Replace and command integration.
- Final accessibility, native input and Windows Chrome behavior.
- Full integrated retention, performance, recovery and compatibility gates.

Alpha.6 adds owned image display sizing; browser layout and pointer UI remain host responsibilities. Alpha.5 adds atomic single-paragraph image placement and replacement with concurrent typing/Enter and owned Undo coverage. Multi-paragraph replacement and mid-list placement remain guarded. Alpha.4 introduced shared upload-slot lifecycle, stale-completion fencing and repeated structural Undo/Redo checks. The optional pending-media ledger is separate from content snapshots; see [MEDIA.md](MEDIA.md). Image nodes refer to host-managed assets. The library does not upload or authorize files. Local Undo is distinct from user-facing document history. Model convergence alone is not evidence of browser-input correctness.

## Host responsibilities

The application must enforce authentication, permissions and revocation; provide durable transport/storage; manage uploads, history/export, folders and guest recovery; and qualify the complete user experience. Never trust a client-provided actor identity or use the editing model as an access-control database.
