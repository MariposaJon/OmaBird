/* SPDX-License-Identifier: MIT */
// Loaded inside the Experiment scope. Only local folder metadata is exported.
var OmaBirdMailBridge = class {
  constructor(owner) {
    this.owner = owner;
    this.directory = PathUtils.parent(owner.statePath);
    this.statusPath = PathUtils.join(this.directory, 'mail.json');
    this.requestPath = PathUtils.join(this.directory, 'request.json');
    this.responsePath = PathUtils.join(this.directory, 'response.json');
    this.mail = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs').MailServices;
    this.utils = ChromeUtils.importESModule('resource:///modules/MailUtils.sys.mjs').MailUtils;
    this.lastStatusAt = 0;
  }

  snapshot() {
    const excluded = Ci.nsMsgFolderFlags.Trash | Ci.nsMsgFolderFlags.Junk | Ci.nsMsgFolderFlags.Virtual;
    const accounts = [];
    for (const server of this.mail.accounts.allServers) {
      if (!['imap', 'pop3', 'none', 'movemail'].includes(server.type)) continue;
      const root = server.rootFolder;
      let unread = 0, inboxURI = '';
      const visited = new Set();
      const walk = folder => {
        if (visited.has(folder.URI) || (folder.flags & excluded)) return;
        visited.add(folder.URI);
        if (folder.flags & Ci.nsMsgFolderFlags.Inbox) inboxURI ||= folder.URI;
        if (!folder.isServer) unread += Math.max(0, folder.getNumUnread(false));
        for (const child of folder.subFolders) walk(child);
      };
      walk(root);
      accounts.push({key:server.key, label:server.prettyName, unread, inboxURI:inboxURI || root.URI});
    }
    return {version:1, running:true, updatedAt:Date.now(), total:accounts.reduce((n,a)=>n+a.unread,0), accounts};
  }

  async write(path, data, suffix = '.tmp') {
    await IOUtils.makeDirectory(this.directory, {ignoreExisting:true});
    const directory = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    directory.initWithPath(this.directory); directory.permissions = 0o700;
    await IOUtils.writeJSON(path, data, {tmpPath:path+suffix});
    const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    file.initWithPath(path); file.permissions = 0o600;
  }

  async publish() {
    if (this.owner.stopped) return;
    const state = this.snapshot();
    await this.write(this.statusPath, state);
    this.lastStatusAt = Date.now();
  }

  async tick() {
    if (this.busy || this.owner.stopped) return;
    this.busy = true;
    try {
      if (Date.now() - this.lastStatusAt >= 5000) await this.publish();
      if (!(await IOUtils.exists(this.requestPath))) return;
      const request = await IOUtils.readJSON(this.requestPath);
      if (request.id === this.lastRequest || typeof request.id !== 'string' || request.id.length > 100) return;
      this.lastRequest = request.id;
      const age = Date.now() - request.issuedAt;
      if (!Number.isFinite(age) || age < -5000 || age > 30000) return;
      if (await IOUtils.exists(this.responsePath)) {
        const response = await IOUtils.readJSON(this.responsePath);
        if (response.id === request.id) return;
      }
      let error = null;
      try { await this.act(request); } catch (e) { error = String(e); }
      await this.write(this.responsePath, {id:request.id, ok:!error, error});
      await this.publish();
    } catch (error) { console.error('OmaBird mail bridge:', error); }
    finally { this.busy = false; }
  }

  async act(request) {
    if (!['inbox','search','commands'].includes(request.action)) throw new Error('Unsupported mail action');
    const win = Services.wm.getMostRecentWindow('mail:3pane');
    if (!win) throw new Error('Mail window is not ready');
    win.focus();
    if (request.action === 'commands') { this.owner.openMenu(win); return; }
    if (request.action === 'search') { win.QuickSearchFocus(); return; }
    const account = this.snapshot().accounts.find(a => !request.account || a.key === request.account);
    if (!account) throw new Error('Account is no longer available');
    this.utils.displayFolderIn3Pane(account.inboxURI);
  }

  stop() {
    this.write(this.statusPath, {version:1,running:false,updatedAt:Date.now(),total:0,accounts:[]}, '.closed.tmp').catch(error=>console.error('OmaBird status cleanup:',error));
  }
}
