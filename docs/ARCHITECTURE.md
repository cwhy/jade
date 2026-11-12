# Architecture

jade is a coordinated set of five packages, not five services.

`core` and `protocol` have no runtime package dependencies. `collaboration` depends on them. `browser` depends on `core`. `testkit` supplies synthetic fixtures and peer helpers; production packages cannot depend on it.

## Editing and admission

The core owns rich structure, text/formatting identity, selections/anchors, semantic commands, validation and actor-owned Undo. Commands prepare operation intents. Admission validates an operation against the current document before the model applies it. Moving a block should preserve its logical identity; copying creates independent identities.

A collaboration authority records ordered decisions. A client can apply local work optimistically, but durable acceptance and authorization come from the host. The host must commit the operation, outcome and sequence consistently before reporting it saved.

## Browser boundary

The browser adapter owns DOM rendering, selection and input/composition behavior. Host interfaces supply assets and application-specific effects. Application frameworks must not mutate the editor-owned DOM behind the input controller.

## Application boundary

jade does not authenticate users, issue permissions, host WebSockets or write databases. Hosts supply these capabilities through the public session interfaces. They must reconcile uncertain delivery, reject identity spoofing, prevent unauthorized reads/writes, and avoid exposing another user's pending or historical content.

## Versions

Alpha.4 retains document codec 43 and uses wire version 45 for shared image upload lifecycle operations, following wire44 table creation. Upload generations live in an optional pendingMedia ledger separate from structural node snapshots; see [MEDIA.md](MEDIA.md). It can replay existing codec43 records; hosts must gate old clients before delivering new operations. Package versions, document codecs and wire versions are separate concepts. A package rename does not migrate persisted data. Unknown or incompatible formats must be rejected explicitly rather than silently rewritten.

The current public subpath exports are listed in each package's `package.json`. Boundary checks enforce declared dependencies, prohibit cycles and require public imports across packages.
