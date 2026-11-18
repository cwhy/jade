# Paragraph storage and replay — local alpha.11

The prototype must retain anchors, owned Undo and immutable retry payloads while a
long document grows through ordinary editing. Codec 46 / wire 52 add versioned
model execution and a compact private Undo representation. They do not remove old
replicas, events, revisions or user contributions.

## Generation invariant

For model version 2, a paragraph partition retains its live text replica only when
its owner, exact backing pieces, and both adjacent partition identities are
unchanged. A split or join rotates the affected partitions, including empty/end
boundaries where equal text alone is insufficient. Changed sources and destinations
remain in lineage. Materialized concurrent projections retain their existing path.

This avoids recreating every paragraph in a family for each Enter. It does not
promise bounded storage for unlimited edits; meaningful changes still retain
identity and Undo information. Scoped lookup indexes are temporary and never
serialized.

## Old records and pending operations

New seeds include `defaultModelVersion: 2`. Old records retain the absence of that
field, which means model version 1 for unversioned operations. Current clients and
browser planners explicitly set `modelVersion: 2` on new operations. A versioned
operation takes precedence over the record default. Versions other than 1 and 2
are rejected.

Do not add the marker to old records or rewrite queued operation bytes. An older
pending split may be followed by another operation naming the generations that
split originally created. Legacy replay therefore preserves the old algorithm and
its exact generations, receipts and effects. New operations can use version 2 in
that same document. Codec 46 reads codecs 43–45 without inventing a default marker;
wire 52 is required for live traffic, with explicit journal reads for wires 43–51.

## Private Undo encoding

Long consecutive identity arrays in stored delete inverses become `idSpans`:
immutable backing-run ID, start and length. They expand to exactly the original
character IDs when Undo executes. These are not visible offsets, so a peer's
inserted characters are excluded. Only version 2 compacts new effects; legacy
replay remains exact. Public mutations cannot submit private spans. Decoding
validates every span against its retained backing run.

Hosts deciding whether Undo needs background computation must count referenced
identities rather than only serialized bytes: small descriptors can still name
large edits.

## Evidence and limits

`verify-TeCc2o`: 36 internal checks and 3,601 packaged contract checks pass.
Packed-Undo regressions cover peer insertion, Undo/Redo, longer origin-bearing
contributions before/after restoration, private payload rejection, malformed spans
and immutable source states. The grown-document replacement produces exactly the
same full state, receipts and frontiers before and after scoped indexing.

Repeated read-only gap queries share a list-affinity view. Consecutive insertions and erased-fragment restorations share a private
ownership/cut index; each insertion updates only its changed block, and any other
action discards that index. Erasure membership lookups ignore retired entries;
origin-bearing inverse records are read once while history stays fixed. New
replacement Undo stores the inserted runs as one semantic deletion claim instead
of one claim per match. This preserves atomic ownership while avoiding repeated
visibility-ledger scans. These views are ephemeral,
never part of storage or exposed to callers. A profile of the grown app document's
10,000 replacements fell from 12.12 seconds to 1.14 seconds locally; this is a model
replay measurement, not end-to-end latency.

A real-paste model workload uses twenty batches of fifty paragraphs, for 100,000
words. Append: 1,999 replicas, 4,074,706 JSON bytes. Prepend: 2,949 replicas,
4,481,010 bytes. Doubling from 50,000 words grows by about 2× in both cases.
Assertions preserve a 10 MiB limit, a 3× paragraph-count replica bound, exact
content and load validation. Earlier failures are retained, including equal-text
partition reuse and uncompressed inverse storage. These model results do not
qualify app UI responsiveness or Cloudflare deployment; application verification
is tracked separately.

The application-grown record is 6,512,236 bytes / 2,000 replicas at 100,000 words
(including a title, longer account/operation IDs and receipts). Its local browser
check passes exact Replace All, one Undo and Redo: 2.55 / 3.04 / 2.79 seconds, with
maximum frame gaps 217 / 217 / 233 ms, below the unchanged 250 ms test limit.
This single-machine result does not establish Cloudflare limits or regional latency.
