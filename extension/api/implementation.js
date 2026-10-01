// SPDX-License-Identifier: MIT
var omaBird = (() => {
  /* @include-mail-bridge */
  return class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return { omaBird: { start: async () => this.start(context.extension) } };
  }

  async start(extension) {
    if (this.timer) return;
    this.extension = extension;
    this.windows = new Map();
    this.styles = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
    this.support = ChromeUtils.importESModule('resource:///modules/ExtensionSupport.sys.mjs').ExtensionSupport;
    const { NetUtil } = ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs');
    this.css = await new Promise((resolve, reject) => {
      NetUtil.asyncFetch({ uri: extension.getURL('ui.css'), loadUsingSystemPrincipal: true }, (stream, status) => {
        if (!Components.isSuccessCode(status)) { reject(new Error('Unable to read OmaBird stylesheet')); return; }
        resolve(NetUtil.readInputStreamToString(stream, stream.available(), { charset: 'UTF-8' }));
      });
    });
    const stateDirectory = Services.env.get('OMABIRD_STATE_DIR') || PathUtils.join(Services.dirsvc.get('Home', Ci.nsIFile).path, '.local', 'state', 'omabird');
    this.statePath = PathUtils.join(stateDirectory, 'palette.json');
    this.mailBridge = new OmaBirdMailBridge(this);
    await this.refresh();
    this.support.registerWindowListener(extension.id, {
      chromeURLs: ['chrome://messenger/content/messenger.xhtml'],
      onLoadWindow: win => this.attach(win),
      onUnloadWindow: win => this.detach(win),
    });
    this.timer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
    this.timer.initWithCallback(() => { this.refresh(); this.mailBridge.tick(); }, 1500, Ci.nsITimer.TYPE_REPEATING_SLACK);
    await this.mailBridge.tick();
  }

  async refresh() {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    try {
      const data = await IOUtils.readJSON(this.statePath);
      const serialized = JSON.stringify(data);
      if (serialized === this.lastPalette) return;
      const c = data.colors;
      for (const key of ['background', 'foreground', 'accent', 'selection', 'muted', 'dark_background', 'lighter_background', 'bright_foreground']) {
        if (!/^#[0-9a-f]{6}$/i.test(c[key])) throw new Error('Invalid palette color: ' + key);
      }
      if (!['light', 'dark'].includes(data.mode) || typeof data.font !== 'string' || data.font.length > 200) throw new Error('Invalid palette metadata');
      const mix = (a, b, amount) => {
        const values = [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount));
        return '#' + values.map(v => v.toString(16).padStart(2, '0')).join('');
      };
      const lum = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const onAccent = lum(c.accent) > .179 ? '#000000' : '#ffffff';
      const tokens = {
        bg: c.background, panel: c.dark_background, fg: c.foreground,
        hover: c.lighter_background, selection: c.selection, accent: c.accent,
        border: mix(c.background, c.foreground, .23), secondary: mix(c.background, c.foreground, .72),
        'on-accent': onAccent,
      };
      const vars = Object.entries(tokens).map(([k, v]) => `--oma-${k}: ${v} !important;`).join('\n');
      const font = JSON.stringify(data.font).replace(/</g, '\\3c ');
      const tokenCss = `@-moz-document url-prefix("chrome://messenger/"), url("about:3pane"), url("about:message"), url("about:addressbook"), url("about:preferences") { :root { ${vars} --oma-font: ${font}; --oma-mode: ${data.mode}; } }`;
      const uri = Services.io.newURI('data:text/css;charset=utf-8,' + encodeURIComponent(tokenCss + this.css));
      if (this.stopped) return;
      this.styles.loadAndRegisterSheet(uri, this.styles.USER_SHEET);
      if (this.sheet) this.styles.unregisterSheet(this.sheet, this.styles.USER_SHEET);
      this.sheet = uri;
      this.lastPalette = serialized;
      this.palette = data;
      for (const win of this.windows.keys()) this.updateLabel(win);
      console.info('OmaBird applied:', data.name);
    } catch (error) {
      // Retain the previous valid theme during a failed or incomplete desktop update.
      if (String(error) !== this.lastError) console.error('OmaBird palette:', error);
      this.lastError = String(error);
    } finally { this.refreshing = false; }
  }

  updateLabel(win) {
    const button = win.document.getElementById('omabird-menu-button');
    if (button) button.title = `OmaBird · ${this.palette?.name || 'Omarchy'} · Ctrl+Shift+P`;
    const hint = win.document.getElementById('omabird-hint');
    if (hint) hint.textContent = `${this.palette?.name || 'Omarchy'} · ↑↓ select · Enter run · Esc close`;
  }

  attach(win) {
    if (this.windows.has(win)) return;
    const doc = win.document;
    const button = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
    button.id = 'omabird-menu-button';
    button.textContent = 'OmaBird ⌘';
    button.setAttribute('aria-label', 'Open OmaBird command menu');
    button.onclick = () => this.openMenu(win);
    const toolbar = doc.getElementById('unifiedToolbar') || doc.getElementById('tabs-toolbar');
    toolbar?.append(button);
    const keydown = event => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); event.stopPropagation();
        this.openMenu(win);
      }
    };
    win.addEventListener('keydown', keydown, true);
    this.windows.set(win, { keydown, button });
    this.updateLabel(win);
  }

  commands(win) {
    const pane = () => win.gTabmail?.currentAbout3Pane;
    const controller = id => pane()?.controllers?.getControllerForCommand(id);
    const command = (label, id, shortcut = '') => ({
      label, shortcut,
      enabled: () => !!controller(id)?.isCommandEnabled(id),
      run: () => controller(id)?.doCommand(id),
    });
    return [
      { label: 'Write a message', shortcut: 'Ctrl+N', run: () => win.MsgNewMessage(null) },
      command('Reply to message', 'cmd_reply', 'Ctrl+R'),
      command('Reply to everyone', 'cmd_replyall', 'Ctrl+Shift+R'),
      command('Forward message', 'cmd_forward', 'Ctrl+L'),
      command('Archive selected messages', 'cmd_archive', 'A'),
      command('Mark as read', 'cmd_markAsRead'),
      command('Mark as unread', 'cmd_markAsUnread'),
      { label: 'Search all mail', shortcut: 'Ctrl+K', run: () => win.QuickSearchFocus() },
      command('Filter this folder', 'cmd_showQuickFilterBar', 'Ctrl+Shift+K'),
      { label: 'Focus folders', run: () => pane()?.document.getElementById('folderTree')?.focus() },
      { label: 'Focus message list', run: () => pane()?.document.getElementById('threadTree')?.focus() },
      { label: 'Open address book', run: () => win.toAddressBook() },
      { label: 'Mail settings', run: () => win.openPreferencesTab() },
      { label: 'Refresh desktop theme', run: async () => { this.lastPalette = null; await this.refresh(); } },
    ];
  }

  openMenu(win) {
    const doc = win.document;
    if (doc.getElementById('omabird-overlay')) return;
    const html = (tag, id) => { const e = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); if (id) e.id = id; return e; };
    const previousFocus = doc.activeElement;
    const overlay = html('div', 'omabird-overlay');
    const dialog = html('section', 'omabird-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'omabird-heading');
    const heading = html('h2', 'omabird-heading'); heading.textContent = 'OmaBird / Commands';
    const input = html('input', 'omabird-search'); input.placeholder = 'Type an action…'; input.setAttribute('aria-label', 'Search mail actions');
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'omabird-results'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('autocomplete', 'off');
    const results = html('div', 'omabird-results'); results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Mail actions');
    const hint = html('div', 'omabird-hint');
    dialog.append(heading, input, results, hint); overlay.append(dialog);
    let selected = 0, matches = [];
    const actions = this.commands(win);
    const close = () => { overlay.remove(); previousFocus?.focus(); };
    const run = action => { if (action.enabled && !action.enabled()) return; close(); Promise.resolve(action.run()).catch(error => console.error('OmaBird action:', error)); };
    const highlight = () => {
      [...results.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
      const row = results.children[selected];
      if (row && matches.length) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      const query = input.value.trim().toLowerCase();
      matches = actions.filter(a => a.label.toLowerCase().includes(query));
      selected = 0; results.replaceChildren();
      for (const [i, action] of matches.entries()) {
        const row = html('button', `omabird-result-${i}`); row.className = 'omabird-action'; row.setAttribute('role', 'option'); row.tabIndex = -1;
        row.disabled = !!action.enabled && !action.enabled();
        const label = html('span'); label.textContent = action.label;
        const shortcut = html('span'); shortcut.className = 'omabird-shortcut'; shortcut.textContent = action.shortcut || '';
        row.append(label, shortcut); row.onclick = () => run(action); results.append(row);
      }
      if (!matches.length) { const empty = html('div'); empty.textContent = 'No matching actions'; empty.style.padding = '12px'; results.append(empty); }
      highlight();
    };
    input.addEventListener('input', render);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') { event.preventDefault(); input.focus(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (matches.length) { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; highlight(); }
      } else if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); run(matches[selected]); }
      event.stopPropagation();
    });
    overlay.onclick = event => { if (event.target === overlay) close(); };
    doc.documentElement.append(overlay); render(); this.updateLabel(win); input.focus();
  }

  detach(win) {
    const state = this.windows?.get(win);
    if (!state) return;
    win.removeEventListener('keydown', state.keydown, true);
    state.button.remove();
    win.document.getElementById('omabird-overlay')?.remove();
    this.windows.delete(win);
  }

  onShutdown(isAppShutdown) {
    this.stopped = true;
    this.timer?.cancel();
    this.mailBridge?.stop();
    if (this.support) this.support.unregisterWindowListener(this.extension.id);
    for (const win of this.windows?.keys() || []) this.detach(win);
    if (this.sheet) this.styles.unregisterSheet(this.sheet, this.styles.USER_SHEET);
    if (!isAppShutdown) Services.obs.notifyObservers(null, 'startupcache-invalidate');
  }
};
})();
