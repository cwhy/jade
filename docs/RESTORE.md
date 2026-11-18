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

The session currently handles ordinary event replay. Do not treat this model
function as a completed live history-restoration feature. The host/session still
needs a dedicated reset checkpoint protocol, epoch-bound stream issuance and
retirement, durable pending-input recovery, empty session Undo at the boundary,
and lost-response/reload qualification. Authorization, pre-restore history,
request idempotency, title/catalog updates and collaborator notification also
remain host work.

Bounded tests cover exact target content and identities, monotonic clocks,
retained decisions, old/new Undo, duplicate delivery, stale pending operations,
JSON reload, repeated restore, redacted decisions, unresolved media fencing, and
new list Enter/Undo inside restored rich cells. They do not certify the unbuilt
room/client transaction or five-editor UX.
