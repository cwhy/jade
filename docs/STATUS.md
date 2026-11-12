# Status and limitations

jade is an alpha implementation, not a complete editor product or a stable storage-format promise.

## Reproducible coverage

The standalone suite contains 31 internal checks and 3,013 public-contract checks across 79 roots. It exercises text/formatting, rich lists and tables, identity/anchor behavior, owned Undo, client/replay contracts and selected persistence schedules.

`npm test` uses real tarballs in an independent consumer rather than workspace symlinks. Run it to verify the current revision. Counts describe a bounded corpus, not a completion percentage.

Application-dependent browser, native-input, transport and deployment checks are not bundled here. The external-test inventory in `verification/test-scope.json` documents that boundary; those tests are not included in the standalone count. Earlier development measurements do not certify another host application or a later build.

## Still being qualified

- Complete image, selection/move, keyboard and structural-command combinations.
- External/native clipboard fidelity and cross-document asset handling.
- Remaining Find/Replace and command integration.
- Final accessibility, native input and Windows Chrome behavior.
- Full integrated retention, performance, recovery and compatibility gates.

Alpha.4 adds shared upload-slot lifecycle, stale-completion fencing and repeated structural Undo/Redo checks. The optional pending-media ledger is separate from content snapshots; see [MEDIA.md](MEDIA.md). Image nodes refer to host-managed assets. The library does not upload or authorize files. Local Undo is distinct from user-facing document history. Model convergence alone is not evidence of browser-input correctness.

## Host responsibilities

The application must enforce authentication, permissions and revocation; provide durable transport/storage; manage uploads, history/export, folders and guest recovery; and qualify the complete user experience. Never trust a client-provided actor identity or use the editing model as an access-control database.
