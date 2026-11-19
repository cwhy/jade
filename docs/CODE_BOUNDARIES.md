# Paragraphs beside blocks

**Experimental alpha.19.** Lark reference checking and focused model
checks now cover nonempty continuation splitting, empty trailing exit, and
empty nonterminal splitting before code. The exact installed packages pass 38 internal checks, 3,748 contracts across
97 roots and 23 controller scenarios. Application integration/deployment remains
a separate gate; these results do not certify the complete product.

Alpha.19 / wire57 / codec51 introduces `planAdjacentParagraph(state, block,
operation, {side, reuse})`. A new empty paragraph stays in the block's current
body, cell, or list-item container. Reuse focuses an already adjacent paragraph
without publishing an operation or adding an Undo entry. New paragraphs retain
independent identities; simultaneous exits do not merge two authors' births.

The optional browser-controller `adjacentParagraph` planner binds Cmd/Ctrl+Enter
in code to create-or-focus after. `beginCodeBoundary` / `commitCodeBoundary`
provide a session/epoch/composition-checked lease for a host menu. These hooks do
not implement application chrome. Ordinary Enter still inserts a code newline.

A paragraph uses the existing creation ledger, with a paragraph kind, boundary
anchor/side and acceptance position. Creation Undo hides an unused paragraph.
Independent typing or Enter keeps its grammatical extent live; undoing the last
independent contribution hides the inactive birth. Late offline text can revive
its retained identity. Redo restores placement in authority order. Code text,
marks and language are untouched. A continuation paragraph in a list item uses
prose splitting within that item, rather than assigning a new list marker. This
matches the observed nonempty behavior. Empty trailing continuations leave one
item level with the same identity; empty paragraphs before another block split
inside the item. Paragraph exits reuse the existing creation-placement graph,
including concurrent ownership, predecessor dependencies, cut retention and
owned Undo. A peer cut remains an independent paragraph when the move is undone.
A later list suffix retains its item/text identities in a separate list wrapper.
The observed Lark reference used a top-level numbered item inside a table cell;
nested exits and following-item cases have model checks, not direct Lark proof.

This does not certify arbitrary moves, anchor deletion, cross-container joins,
or every conversion around the created paragraph. Changed placement may require
structural review. A remotely cleared/deleted scope cannot be revived by Undo.
The previous table-boundary insertion path remains separate with its established
contract; this change does not silently relax that older path's guards.

The record shape is versioned. Codec50 and earlier supported snapshots retain
identities and receipt decisions during load. Wire56 and earlier supported local
journals replay under an explicit new-version boundary; older live clients must
reload. No receipt pruning, text recreation, or history reset is part of this
change. Tests exercise both authority orders, duplicate delivery, lost replies,
room reload, replay, exact peer text/marks, anchors and owned Undo/Redo.

Full product keyboard/layout, native Mac/Windows input, long team sessions and
all image/table/menu combinations remain separate qualification gates.
