# Historical state boundary (alpha.12 candidate)

`restoreRecord` from `@cwhy/jade-collaboration/restore` is a pure, host-authorized
transition. It is not an ordinary mutation and does not authorize a user to read
history or restore a document. The host must supply a validated historical state
from the same document, bind confirmation to the current head, and commit the
result with its control receipt and historical checkpoints atomically.

```js
import {restoreRecord} from '@cwhy/jade-collaboration/restore';
const next = restoreRecord(currentRecord, historicalState, {id: restoreRequestId});
```

The target argument is a state, not an old room record. Current mutation receipts
and stream frontiers survive. Replacing them with the historical receipt map would
lose duplicate-delivery decisions and incorrectly reopen old sequence numbers.
The root identity must match, but the engine has no host document ID: same-document
provenance remains the host's responsibility.

The transition advances the current epoch and revision by one; it never reuses the
target's clocks. Nodes, text identities, marks and structural lineage come from the
historical state. Historical effects remain necessary to interpret ownership and
origins, so they are retained and marked `retiredByRestore` instead of deleted.
New Undo cannot target them. New edits in the restored state retain normal owned
Undo/Redo. Ordinary old-epoch operations are rejected; already-decided duplicates
return their original receipt, which does not assert present-day visibility.

Every unresolved historical image slot receives a fresh completion generation.
A delayed completion from before the boundary cannot fill that restored slot.
The host decides how to offer explicit recovery/retry and retains referenced
historical media. Completed assets and structural content remain unchanged.

Codec47 reads codecs43–46 without adding fabricated identities or changing saved
operation bytes. Wire53 fences clients unaware of retired Undo effects. Upgrading
a record alone does not perform a restore or retire any effects.

## Integration still required

The session now accepts an ordered `reset` message with `{checkpoint:{wire,record,cursor}}`
through explicit host ports. It pauses mutation preparation, saves the old queue,
reconciles own receipts, installs a fresh stream only after journal reset commits,
and clears session Undo. Duplicate delivery preserves new-epoch pending work.
A newer restore during stream issuance reconnects without treating it as a local
recovery failure. This is not a completed application restoration feature. The host
still needs epoch-bound stream issuance/retirement and an atomic journal reset
implementation, plus actual browser/room lost-response and reload qualification. Authorization, pre-restore history,
request idempotency, title/catalog updates and collaborator notification also
remain host work.

Bounded tests cover exact target content and identities, monotonic clocks,
retained decisions, old/new Undo, duplicate delivery, stale pending operations,
JSON reload, repeated restore, redacted decisions, unresolved media fencing, and
new list Enter/Undo inside restored rich cells. They do not certify the unbuilt
room/client transaction or five-editor UX.

## Session reset ports

- `beforeReset({fromEpoch,toEpoch})`: optional async host hook to retain unfinished
  composition/new media input. The client is paused before this hook runs.
- `createResetStream(epoch)`: returns `{stream,epoch,actor?}`. Bind issuance to the
  expected current epoch. A newer epoch result, or an error with code
  `RESTORE_CHANGED`, reconnects for the newer checkpoint without installing a
  mismatched stream. Fresh streams must differ from the retired stream.
- `journal.reset(head,checkpoint,boundary)`: atomically preserve recovery/retired
  work and replace the active journal. `boundary.retired` contains original pending
  envelopes and decisions (`accepted`, `rejected`, `not-recorded`). Only accepted
  decisions remove eligible recovery entries. Return `{recoveryCount}` if available.
  A failed transaction must leave the old journal readable.
- `onRestore({fromEpoch,epoch,recoveryCount})`: optional notification after durability.
  `onDurable` likewise runs only after the replacement journal commits.

The host must bind old streams to their issued epoch and make not-recorded status
terminal after retirement. A late old-stream submission must not turn a completed
reset into a fatal error in the fresh session. Ordinary event delivery must not
overtake the reset checkpoint's acknowledgement. An already-closed session never
installs or renders a newly completed reset.
