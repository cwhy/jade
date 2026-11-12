# jade

**just-a-doc-engine** — an experimental rich-document editing engine.

jade provides document structure, editing commands, stable identities, collaborative Undo and browser input/rendering adapters. It is designed for rich cells containing paragraphs, lists, code and images. It is not a Markdown-based document model or a ready-made document application.

> **Alpha software.** The API and document format may change. Do not treat the current tests as production certification. See [status and limitations](docs/STATUS.md).

## What is here

- Rich text and formatting, lists, code blocks, image references and rectangular tables.
- Structural commands and stable selection/anchor identities.
- Actor-owned Undo/Redo and deterministic collaboration decisions/replay.
- Browser DOM, selection, composition and clipboard adapters.
- Standalone regression tests that run against actual packaged artifacts.

Authentication, permissions, hosting, databases, asset storage and application screens belong to the host application. jade does not supply a hosted collaboration service.

## Try it

Open the [Jade playground](https://cwhy.github.io/jade/) to try two collaborating
editors in one browser tab. The demo uses the real engine with an in-memory
authority; it does not upload text or persist edits. See the [short guide](https://cwhy.github.io/jade/guide.html).

Requirements: Node.js 22.13 or newer and npm. No registry packages are required to run the standalone suite.

```sh
git clone https://github.com/cwhy/jade.git
cd jade
npm test
```

The verifier checks package boundaries, runs internal tests, packs the five libraries, installs them into an independent temporary consumer and runs public-contract tests. Logs and results are written under ignored `artifacts/verify-*` directories.

To run the [basic editing example](examples/basic-editing.mjs) directly:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund
node examples/basic-editing.mjs
```

For local integration:

```sh
npm run pack:local
```

This creates tarballs and `package-set.json` in `artifacts/packages`. Install the coordinated package set by file path. The packages are **not published to npm**; `private: true` prevents accidental registry publication.

To build and serve the public site locally:

```sh
npm run site:build
npm run site:serve
```

Open `http://localhost:4173`. The site uses native browser modules and a generated
import map of public package exports. GitHub Pages publishes only `artifacts/site`,
not the working tree. The deploy workflow runs the engine contracts and the site
integration checks before publication. See [site maintenance](docs/SITE.md).

## Packages

| Package                    | Responsibility                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `@cwhy/jade-core`          | Document model, commands, validation, identities, selections/anchors and owned Undo |
| `@cwhy/jade-browser`       | DOM rendering, selection, input/composition and clipboard adapters                  |
| `@cwhy/jade-collaboration` | Client/session orchestration, authority decisions and replay through host ports     |
| `@cwhy/jade-protocol`      | Wire version and operation-envelope validation                                      |
| `@cwhy/jade-testkit`       | Reusable synthetic fixtures and test peers                                          |

Only documented package exports are supported. Do not import source files from another package. The browser package is optional for server consumers. See [architecture](docs/ARCHITECTURE.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing an editing invariant or document format. Preserve failing assertions, add a focused regression for behavior changes, and run the packaged test suite.

## License

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).

You may use jade in open-source or proprietary applications. When distributing covered code, follow the MPL requirements for source availability and notices. See the [Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) for guidance.

### Authorized replication (alpha.2)

`@cwhy/jade-collaboration/public-replication` provides `publicRecord(record, actor)`,
`publicEvent(event, actor)` and the `publicReplication` session adapter. Hosts must
choose `actor` from authenticated authority, project both checkpoints and events
on the server, and pass `replication: publicReplication` to `DocumentSession`.
Foreign rejected drafts and rejection reasons become sequence-only markers;
accepted operations and the recipient's own decisions retain exact replay and
retry validation. Full authority storage is unchanged (codec43/wire43).

The default session adapter remains the existing full-record replay contract.
A host may supply `{replay, verifyDuplicate}` as `ports.replication`; both must be
synchronous deterministic validators. Journal-before-send, catchup ordering and
Saved-after-journal semantics remain owned by `DocumentSession`. This hook does
not provide authentication, access revocation, encryption or a transport.

### Block insertion (alpha.3)

`planInsertBlock` (core commands) and the browser controller's
`captureInsertion()` / `insertBlock(options, bookmark)` provide explicit bullet
list, numbered list, code block and regular table insertion. The host owns the
buttons, dialogs and notices; the controller owns selection, history and commit.

Table creation currently accepts 1–20 rows and 1–12 columns at the end of a
body paragraph. Mid-paragraph and nested-table insertion are rejected explicitly.
Creation Undo refuses to remove a table with later text or structural changes;
row/column editing and reviewed deletion remain separate commands.

This adds wire version **44** while retaining document codec **43**. Readers can
replay existing codec43 records. Hosts must upgrade their wire gate and require
older connected clients to reload before delivering table-creation operations.
It is not safe to send the new command to a wire43 client. No storage rewrite is
required. Existing experimental-format and alpha limitations still apply.

Hosts that apply transport backpressure can supply the synchronous session port
`onDurable({cursor, seq})`. It fires only after a journal write succeeds, including
when later local edits remain pending. Use it to acknowledge durable receive
progress independently of document rendering. Failed journal writes never release
transport credit. Wire43 local journals, including unchanged offline pending
operations, can reopen with wire44; other unsupported journal versions fail closed.

### Shared upload foundation (alpha.4)

Wire **45** adds shared image slots and host-generated completion, preserving
original-insert Undo and rejecting late completion after deletion/restoration.
The pending upload generation is separate from structural content. Existing
codec43 records and wire43/44 journals remain readable on one-way upgrade.
This is an engine lifecycle capability; a host still needs an authorized upload
service and image UI. See [the media contract](docs/MEDIA.md) for the authority
boundary, supported transitions and remaining scope.

### Atomic image placement (alpha.5)

Wire **46** adds single-image insertion inside a body/cell paragraph, including
replacement of text selected within that paragraph. Erasure, paragraph splitting
and shared slot creation are one owned edit; concurrent text and Enter retain
their own identities through Undo/Redo. The controller's
`captureInsertion({allowRange: true})` opts into range bookmarks. Multi-paragraph
replacement and middle-of-list-item placement remain guarded.

Codec **43** and wire43/44/45 offline journals remain readable on one-way upgrade.
Hosts must advance their wire gate and close older clients before new operations
are delivered. See [MEDIA.md](docs/MEDIA.md) for scope and lifecycle semantics.
