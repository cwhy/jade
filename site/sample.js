// SPDX-License-Identifier: MPL-2.0
import { seed } from '@cwhy/jade-core/model';

// Entirely fictional, intentionally small. Rich cells use the same document nodes.
export function sample() {
  const nodes = {}, contents = {};
  function node(id, type, children, attrs = {}) {
    nodes[id] = { id, type, live: true, ...(children ? { children } : {}), ...attrs };
    return id;
  }
  function text(id, value, marks = [], type = 'paragraph') {
    node(id, type); contents[id] = [{ text: value, marks }]; return id;
  }
  function item(id, value) { return node(id, 'list_item', [text(id + '-text', value)]); }
  function cell(id, children, width) { return node(id, 'cell', children, { colwidth: [width] }); }
  node('doc', 'doc', [
    text('title', 'Field notes', ['strong']),
    text('intro', 'A small set of notes from a walk. This document is shared between two editors.'),
    node('list', 'bullet_list', [item('heron', 'Spotted a heron by the river.'), item('trail', 'The trail was clear and quiet.')]),
    node('table', 'table', [
      node('heading', 'row', [cell('topic-heading', [text('topic-label', 'Topic')], 100), cell('notes-heading', [text('notes-label', 'Notes')], 240)]),
      node('weather', 'row', [cell('weather-topic', [text('weather-label', 'Weather')], 100), cell('weather-notes', [text('weather-text', 'Cool and sunny.')], 240)]),
      node('ideas', 'row', [cell('ideas-topic', [text('ideas-label', 'Next time')], 100), cell('ideas-notes', [node('ideas-list', 'bullet_list', [item('map', 'Bring a map.'), item('route', 'Try the longer route.')])], 240)]),
      node('code-row', 'row', [cell('code-topic', [text('code-label', 'A little code')], 100), cell('code-notes', [text('code', 'const route = "riverside";', [], 'code')], 240)]),
    ], { headerRow: true }),
    text('tail', 'What would you add?'),
  ]);
  return seed(nodes, contents);
}
