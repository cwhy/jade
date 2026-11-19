# Owned code-language metadata

Alpha.17 exposes `planCodeLanguage(state, blockId, language, operation)`,
`CODE_LANGUAGES` and `codeLanguageState(node)` from the public commands module.
The initial supported choices are plaintext, javascript, typescript, python, sql,
json, html, css, bash, yaml and markdown. Existing legacy language strings remain
intact until explicitly changed; Undo restores their exact value and presence.

Each code block stores an ordered contribution ledger. The last accepted active
choice wins. Owned Undo disables only the author's contribution; later peer
choices remain. Redo reactivates the original contribution at its original
priority. Explicit Plain text is a real choice, unlike a block with no explicit
language. Text replicas, character identities, formatting and anchors are untouched.
Inactive metadata history cannot trap Undo of an earlier block insertion. Active
peer metadata protects the block from silent structural removal. Deleted blocks
must be restored before their language choice can be undone.

The public browser controller accepts the `codeLanguage` planner and exposes
`beginCodeLanguage(blockId)` / `commitCodeLanguage(lease, language)`. It retains
code selection anchors, uses ordinary owned history and rejects disposed/changed
sessions or active composition. The host owns picker UI, authorization, search,
keyboard navigation, detection and highlighting. Detection is not implemented by
this primitive; a later paste integration must preserve explicit choices and
atomic one-Undo text/language behavior.

Codec49 adds the ledger; wire55 fences older live clients before document data is
sent. Explicit load accepts codec43–48 without inventing previous language edits.
Legacy wire43–54 journals retain operation bytes and receipts during atomic load.
Copy/export carries visible language and code, excluding source operation/actor
metadata. This changes no recorded text operation semantics and prunes no history.

Sixteen dedicated contracts cover language/text concurrency, exact Undo/Redo,
legacy load, uncertain delivery, copied identity exclusion, table deletion/restore,
and code created in body, cells and numbered items. Six focused headless browser
checks cover selection, peer typing, composition guards and stale controller leases.
Native IME and a rendered picker are not certified by these controller checks.
