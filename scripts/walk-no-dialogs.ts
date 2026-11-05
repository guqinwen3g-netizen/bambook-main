import type { Plugin } from 'vite';

/**
 * Walkthrough-only guard: the embedded preview browser has no way to dismiss native
 * save / print / file-picker dialogs, so a single download stalls the whole walk.
 * When MIST_WALK_NO_DIALOGS=1, the dev page records those requests in
 * `window.__walkDialogs` instead of opening the native dialog. Never active in builds.
 */
const GUARD = `(() => {
  const log = window.__walkDialogs = [];
  const note = (kind, detail) => { log.push({ kind, detail, at: new Date().toISOString() }); console.info('[walk] ' + kind + ' suppressed', detail); };
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) return note('download', this.getAttribute('download') || this.href);
    return anchorClick.call(this);
  };
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element && event.target.closest('a[download]');
    if (anchor) { event.preventDefault(); note('download', anchor.getAttribute('download') || anchor.href); }
  }, true);
  const inputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') return note('file-picker', this.accept || '');
    return inputClick.call(this);
  };
  window.print = () => note('print', document.title);
  for (const name of ['showSaveFilePicker', 'showOpenFilePicker', 'showDirectoryPicker'])
    if (name in window) window[name] = async () => { note(name, ''); throw new DOMException('Suppressed during walkthrough', 'AbortError'); };
})();`;

export function walkNoDialogsPlugin(): Plugin {
  return {
    name: 'bambook-walk-no-dialogs',
    apply: 'serve',
    transformIndexHtml() {
      return process.env.MIST_WALK_NO_DIALOGS === '1' ? [{ tag: 'script', children: GUARD, injectTo: 'head-prepend' }] : [];
    },
  };
}
