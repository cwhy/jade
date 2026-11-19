# Literal code input

Alpha.16 implements the bounded CD-03/CD-10 input slice without changing codec48
or wire54. Existing recorded operations and snapshots keep their meaning. New
Enter commands capture the current line's leading spaces/tabs up to the caret
and insert LF plus that indentation as one owned operation. Replay never
recomputes indentation against a later document. Enter within indentation copies
only the prefix before the caret; selected text is replaced and restored by Undo.

`literalFragment(text)` uses the existing 100,000-character input limit and LF
normalization, but emits one text block irrespective of line count. The browser
controller uses this path for code typing, composition commit and host-prepared
plain paste. Code paste consumes `text/plain` before internal rich/grid envelope
handling; image-only or other non-text clipboard content leaves the selection
unchanged and explains that a text representation is required. It creates no
media upload or prose blocks inside code. Existing literal tabs remain literal.

Twenty-two model contracts cover body/cell input, Unicode, indentation, boundary
delete isolation, LF normalization, 3,000-line paste, selected replacement,
concurrent text in both arrival orders, persisted Undo/Redo and exact peer text.
Eight isolated browser scenarios cover both containers and ordinary/prepared
paste. These do not qualify native IME, the host application's clipboard adapter,
shared language selection, detection, highlighting, exit shortcuts or full code UX.

Package verification and application integration must use the exact final
artifact; see STATUS.md for the current evidence.
