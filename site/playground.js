// SPDX-License-Identifier: MPL-2.0
import { bindSelectionController } from '@cwhy/jade-browser/controller';
import { createDocumentRenderer } from '@cwhy/jade-browser/renderer';
import { captureDOMRange, installDOMRange } from '@cwhy/jade-browser/dom-selection';
import { planReplace, planEnter, planDelete, planCodeIndent, planListIndent, planNavigateCell, planBoundaryParagraph, planRichInsert } from '@cwhy/jade-core/commands';
import { sample } from './sample.js';
import { LocalRoom } from './local-room.js';

const container = document.querySelector('#editors');
let cleanup = () => {};
function start() {
  cleanup(); container.replaceChildren();
  const room = new LocalRoom(sample()), controllers = [];
  for (const name of ['A', 'B']) {
    const panel = document.createElement('section');
    panel.className = 'editor-panel'; panel.setAttribute('aria-label', 'Editor ' + name);
    panel.innerHTML = `<div class="editor-heading"><h3>Editor ${name}</h3><span class="status" role="status">Connected</span></div><div class="toolbar" role="group" aria-label="Editor ${name} controls"><button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="connection" aria-pressed="false">Disconnect</button></div><div class="editor" role="textbox" aria-label="Editor ${name} document" aria-multiline="true" contenteditable="true" spellcheck="false"></div><p class="editor-notice" role="status"></p>`;
    container.append(panel);
    const root = panel.querySelector('.editor'), status = panel.querySelector('.status'), notice = panel.querySelector('.editor-notice');
    const undo = panel.querySelector('[data-action="undo"]'), redo = panel.querySelector('[data-action="redo"]'), connection = panel.querySelector('[data-action="connection"]');
    const renderDocument = createDocumentRenderer(root);
    let controller;
    function capture() { try { return captureDOMRange(peer.client.state, root); } catch { return null; } }
    function render(bookmark) {
      if (!controller?.isComposing()) {
        renderDocument(peer.client.state);
        if (bookmark && document.activeElement === root) {
          try { installDOMRange(peer.client.state, root, bookmark); } catch { /* Selection may have been removed by an edit. */ }
        }
      }
      const pending = peer.client.pending.length;
      status.textContent = peer.connected ? (pending ? 'Syncing…' : 'Connected') : (pending ? `Offline · ${pending} pending` : 'Offline');
      status.classList.toggle('offline', !peer.connected);
      connection.textContent = peer.connected ? 'Disconnect' : 'Reconnect';
      connection.setAttribute('aria-pressed', String(!peer.connected));
      undo.disabled = !peer.client.undoStack.length || !!controller?.isComposing();
      redo.disabled = !peer.client.redoStack.length || !!controller?.isComposing();
      if (peer.client.recovery.length) {
        notice.textContent = 'This edit needs recovery. Reset the sample to try again; this demo has no recovery workspace.';
        root.contentEditable = 'false';
      }
    }
    const peer = room.add('editor-' + name, mutate => { const bookmark = controller?.isComposing() ? null : capture(); mutate(); render(bookmark); });
    controller = bindSelectionController({
      root, client: () => peer.client,
      commit: () => { room.schedule(); }, render,
      notice: message => { notice.textContent = message; },
      commands: { replace: planReplace, enter: planEnter, delete: planDelete, codeIndent: planCodeIndent, listIndent: planListIndent, navigateCell: planNavigateCell, boundaryParagraph: planBoundaryParagraph, richInsert: planRichInsert },
      domSelection: { captureDOMRange, installDOMRange },
    });
    panel.querySelector('.toolbar').addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
    for (const [button, action] of [[undo, 'undo'], [redo, 'redo']]) button.addEventListener('click', () => {
      if (controller.isComposing()) return;
      try { const bookmark = capture(); peer.client[action](); render(bookmark); room.schedule(); notice.textContent = ''; }
      catch (error) { notice.textContent = error.message; }
    });
    connection.addEventListener('click', () => room.toggle(peer));
    render(); controllers.push(controller);
  }
  container.setAttribute('aria-busy', 'false');
  cleanup = () => { room.close(); for (const controller of controllers) controller.dispose(); };
}
try {
  start();
  const reset = document.querySelector('#reset'); reset.hidden = false;
  reset.addEventListener('click', () => { if (confirm('Reset both editors? Changes in this demo will be discarded.')) start(); });
} catch (error) {
  container.setAttribute('aria-busy', 'false');
  container.textContent = 'The playground could not start. Try a current version of desktop Chrome, or read the guide.';
  console.error(error);
}
