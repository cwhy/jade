// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalRoom } from '../site/local-room.js';
import { sample } from '../site/sample.js';
import { gapAt, text } from '@cwhy/jade-core/model';

const output = fileURLToPath(new URL('../artifacts/site/', import.meta.url));
const files = directory => readdirSync(directory).flatMap(name => {
  const file = path.join(directory, name); return statSync(file).isDirectory() ? files(file) : [file];
});
test('Pages output resolves its imports and local links under a project subpath', () => {
  const index = readFileSync(path.join(output, 'index.html'), 'utf8');
  const map = JSON.parse(index.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
  for (const target of Object.values(map)) assert.ok(existsSync(path.resolve(output, target)), target);
  for (const file of files(output)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.js')) {
      for (const match of source.matchAll(/^\s*(?:import\s+[^;]*?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?))\s+from\s*['"]([^'"]+)['"]/gm)) {
        const target = match[1].startsWith('.') ? path.resolve(path.dirname(file), match[1]) : path.resolve(output, map[match[1]] || 'MISSING');
        assert.ok(target.startsWith(output) && existsSync(target), `${file}: ${match[1]}`);
      }
    }
    if (file.endsWith('.html')) for (const match of source.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const href = match[1].split('#')[0];
      if (/^https?:/.test(href)) continue;
      assert.ok(!href.startsWith('/'), 'Project site must use relative URLs: ' + href);
      assert.ok(existsSync(path.resolve(path.dirname(file), href)), href);
    }
  }
  assert.ok(existsSync(path.join(output, 'LICENSE')));
  assert.ok(!existsSync(path.join(output, 'node_modules')));
});
function pair() {
  const host = new LocalRoom(sample());
  const changed = mutate => mutate();
  return { host, a: host.add('A', changed), b: host.add('B', changed) };
}
function value(peer, block = 'tail') { return text(peer.client.state, block).map(atom => atom.char).join(''); }
function append(peer, value, block = 'tail') {
  peer.client.prepare({ kind: 'insert', at: gapAt(peer.client.state, block, text(peer.client.state, block).length), text: value, marks: [] });
}
test('two clients synchronize; Undo and Redo preserve the other actor', () => {
  const { host, a, b } = pair(); const original = value(a);
  append(a, ' A'); host.flush(); append(b, ' B'); host.flush();
  assert.equal(value(a), original + ' A B'); assert.equal(value(a), value(b));
  a.client.undo(); host.flush(); assert.equal(value(a), original + ' B'); assert.equal(value(a), value(b));
  a.client.redo(); host.flush(); assert.equal(value(a), original + ' A B');
  b.client.undo(); host.flush(); assert.equal(value(a), original + ' A');
  host.close();
});
test('both disconnected clients reconcile same-paragraph edits without duplicates', () => {
  const { host, a, b } = pair(); const original = value(a);
  host.toggle(a); host.toggle(b); append(a, ' FIRST'); append(b, ' SECOND'); host.flush();
  assert.equal(value(a), original + ' FIRST'); assert.equal(value(b), original + ' SECOND');
  host.toggle(b); host.flush(); host.toggle(a); host.flush();
  assert.equal(value(a), value(b)); assert.equal(value(a).split('FIRST').length, 2); assert.equal(value(a).split('SECOND').length, 2);
  const settled = value(a); host.flush(); host.flush(); assert.equal(value(a), settled);
  assert.equal(a.client.pending.length + b.client.pending.length, 0);
  assert.deepEqual(a.client.recovery, []); assert.deepEqual(b.client.recovery, []); host.close();
});
test('code and list content in rich cells uses the same collaboration path', () => {
  const { host, a, b } = pair();
  append(a, '\n// a note', 'code'); append(b, ' And water.', 'map-text'); host.flush();
  assert.equal(value(a, 'code'), value(b, 'code')); assert.match(value(b, 'code'), /a note/);
  assert.equal(value(a, 'map-text'), 'Bring a map. And water.'); host.close();
});
test('closing a demo cancels queued exchange before a reset', async () => {
  const { host, a } = pair(); const revision = host.room.snapshot().state.revision;
  append(a, 'discard'); host.schedule(); host.close(); await Promise.resolve();
  assert.equal(host.room.snapshot().state.revision, revision);
  assert.equal(value(pair().a), 'What would you add?');
});
