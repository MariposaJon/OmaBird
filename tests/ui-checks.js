// SPDX-License-Identifier: MIT
// Injected only into a disposable test XPI by ui.py; never shipped in OmaBird.
async function runOmaBirdUiChecks(owner) {
  const output = Services.env.get('OMABIRD_UI_TEST_OUTPUT');
  const checks = [];
  const {setTimeout} = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const wait = async (fn, label) => {
    for (let i=0;i<100;i++) { const result=fn(); if(result) return result; await sleep(100); }
    throw new Error('Timed out: '+label);
  };
  const assert = (condition,label) => { if(!condition) throw new Error(label); checks.push(label); };
  const report = {ok:false,checks};
  try {
    const profile = Services.dirsvc.get('ProfD',Ci.nsIFile).path;
    if (profile !== Services.env.get('OMABIRD_UI_TEST_PROFILE')) throw new Error('Disposable profile required');
    const w = await wait(()=>{ const candidate=Services.wm.getMostRecentWindow('mail:3pane'); return candidate?.gTabmail?.openTab ? candidate : null; },'initialized mail window');
    const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
    const {MailUtils} = ChromeUtils.importESModule('resource:///modules/MailUtils.sys.mjs');
    MailServices.accounts.createLocalMailAccount();
    const root=MailServices.accounts.localFoldersServer.rootFolder;
    root.createSubfolder('OmaBird UI',null);
    const folder=root.getChildNamed('OmaBird UI');
    const local=folder.QueryInterface(Ci.nsIMsgLocalMailFolder);
    const bodies=[
      '<html><body><p id="fallback">An unstyled message.</p><p id="inline" style="font-family:Georgia">Author font.</p><font id="legacy" face="Arial">Legacy author font.</font></body></html>',
      '<html style="font-family:Georgia"><body><p id="rootfont">Inherited author font.</p></body></html>',
      '<html><head><style>body {font-family:Arial}</style></head><body><p id="cssfont">Author stylesheet font.</p></body></html>',
    ];
    const headers=bodies.map((body,i)=>{
      const id=`omabird-ui-${i}@example.invalid`;
      local.addMessage(`From - Thu Oct 01 12:00:00 2026\nFrom: Demo Person <demo@example.invalid>\nTo: Demo Recipient <recipient@example.invalid>\nSubject: ${i===0?'A bright unread subject':'A quieter read subject'}\nMessage-ID: <${id}>\nDate: Thu, 1 Oct 2026 12:00:00 +0000\nMIME-Version: 1.0\nContent-Type: text/html; charset=UTF-8\n\n${body}\n`);
      return folder.msgDatabase.getMsgHdrForMessageID(id);
    });
    for (let i=0;i<headers.length;i++) headers[i].markRead(i!==0);
    report.fixture={count:folder.getTotalMessages(false),headers:headers.map(h=>h.subject),uri:folder.URI};
    await wait(()=>w.gTabmail.currentAbout3Pane?.document.readyState==='complete' && w.gTabmail.currentAbout3Pane?.gFolder,'ready folder tab');
    MailUtils.displayFolderIn3Pane(folder.URI);
    let pane = await wait(()=>{ const p=w.gTabmail.currentAbout3Pane; return p?.gDBView?.rowCount===3 ? p : null; },'message rows');
    pane.controllers.getControllerForCommand('cmd_threadPaneViewCards').doCommand('cmd_threadPaneViewCards');
    const tree=pane.document.getElementById('threadTree');
    await wait(()=>tree.querySelector('.card-layout[data-properties~="unread"] .subject')?.textContent,'populated card markup');
    const rows=[...tree.querySelectorAll('.card-layout[data-properties]')];
    const unread=rows.find(r=>r.dataset.properties.split(' ').includes('unread'));
    const read=rows.find(r=>r.dataset.properties.split(' ').includes('read'));
    assert(!!unread && !!read,'read and unread cards rendered');
    const subjectStyle=pane.getComputedStyle(unread.querySelector('.subject'));
    const metaStyle=pane.getComputedStyle(unread.querySelector('.sender'));
    const readStyle=pane.getComputedStyle(read.querySelector('.subject'));
    assert(subjectStyle.color!==metaStyle.color,'subject and correspondent have distinct colors');
    assert(subjectStyle.color!==readStyle.color,'read subject is quieter than unread subject');
    assert(Number(subjectStyle.fontWeight)>Number(readStyle.fontWeight),'unread subject has stronger weight');
    assert(pane.getComputedStyle(unread.querySelector('.date')).opacity==='1','date contrast is not reduced by opacity');
    unread.dataset.properties += ' tagged';
    assert(pane.getComputedStyle(unread).getPropertyValue('--oma-row-subject').trim()==='', 'tagged row retains native semantic styling');
    unread.dataset.properties=unread.dataset.properties.replace(' tagged','');
    const messageDoc = async header => {
      MailUtils.displayMessageInFolderTab(header,true);
      return await wait(()=>{
        const p=w.gTabmail.currentAbout3Pane;
        const about=p?.document.getElementById('messageBrowser')?.contentWindow;
        const browser=about?.document.getElementById('messagepane');
        const doc=browser?.contentDocument;
        return doc && doc.body?.textContent.includes(header.messageId.startsWith('omabird-ui-0')?'An unstyled':header.messageId.startsWith('omabird-ui-1')?'Inherited author':'Author stylesheet') ? doc:null;
      },'message HTML');
    };
    const first=await messageDoc(headers[0]);
    const family=id=>first.defaultView.getComputedStyle(first.getElementById(id)).fontFamily;
    report.fonts={fallback:family('fallback'),inline:family('inline'),legacy:family('legacy'),html:first.documentElement.outerHTML.slice(0,3000)};
    assert(family('fallback').includes(owner.palette.font),'unstyled HTML uses the Omarchy font');
    assert(family('inline').includes('Georgia'),'inline author font preserved');
    assert(family('legacy').includes('Arial'),'legacy HTML font face preserved');
    const second=await messageDoc(headers[1]);
    assert(second.defaultView.getComputedStyle(second.getElementById('rootfont')).fontFamily.includes('Georgia'),'font inherited from authored html preserved');
    const third=await messageDoc(headers[2]);
    assert(third.defaultView.getComputedStyle(third.getElementById('cssfont')).fontFamily.includes('Arial'),'author stylesheet font preserved');
    // Theme refresh changes the message fallback without touching authored fonts.
    const testPalette={...owner.palette,font:'DejaVu Sans Mono'};
    await IOUtils.writeJSON(owner.statePath,testPalette);
    owner.lastPalette=null; await owner.refresh();
    const updated=await messageDoc(headers[0]);
    assert(updated.defaultView.getComputedStyle(updated.getElementById('fallback')).fontFamily.includes('DejaVu Sans Mono'),'message fallback follows live desktop font changes');
    assert(updated.defaultView.getComputedStyle(updated.getElementById('inline')).fontFamily.includes('Georgia'),'authored font survives live update');
    // Also check ordinary table columns rather than only card presentation.
    pane=w.gTabmail.currentAbout3Pane;
    pane.controllers.getControllerForCommand('cmd_threadPaneViewTable').doCommand('cmd_threadPaneViewTable');
    await wait(()=>tree.querySelector('.table-layout .subject-line > span'),'table markup');
    const row=tree.querySelector('.table-layout');
    const tableSubject=pane.getComputedStyle(row.querySelector('.subject-line > span'));
    const tableMeta=pane.getComputedStyle(row.querySelector('.correspondentcol-column'));
    assert(tableSubject.color!==tableMeta.color,'table view has the same subject/metadata hierarchy');
    report.ok=true;
  } catch(error) { report.error=String(error); report.stack=error.stack; }
  finally {
    await IOUtils.writeJSON(output,report);
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  }
}
