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


## Atomic paste and automatic defaults (alpha.18)

`planCodePaste(state, range, value, op, {language, inheritedMarks})` accepts a
synchronous host classification. The host's detector is not part of Jade. A new
optional controller `codePaste` planner serves both the clipboard event and
host-prepared text path; surfaces omitting it retain literal paste behavior.

For empty code without an explicit choice, the language hint and text insertion
share one operation. Authority rechecks a captured document revision plus current
emptiness and explicit-choice status before accepting the hint. An intervening
edit, including unrelated text, conservatively suppresses only the hint. This
avoids a second asynchronous operation and never discards otherwise valid pasted
text to preserve a language guess. Nonempty code and explicit choices retain their
language. Unknown classifications must be normalized to Plain text by the host.

An automatic layer is an implicit default. Active manual layers take precedence;
Undo/Redo of either changes only its own layer. Paste Undo removes its text and
hint together while retaining later peer text and manual choices. Automatic
results never execute code or replace text with highlighter output. Supported
previous records and receipts remain immutable at the load boundary.
