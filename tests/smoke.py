"""Integration checks using a disposable Betterbird profile on Marionette port 2829.

Never point this at a mail profile: it creates synthetic local messages.
"""
from pathlib import Path
import json
import subprocess
import time
from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parents[1]
STATE = Path.home() / '.local/state/omabird/palette.json'
m = Marionette('localhost', port=2829)
m.start_session()
m.set_context('chrome')
m.timeout.script = 30

def js(script):
    return m.execute_script("const w=Services.wm.getMostRecentWindow('mail:3pane'); const d=w.document; " + script)

def wait(script):
    for _ in range(40):
        if js(script):
            return
        time.sleep(.15)
    raise AssertionError(script)

def menu_query(text):
    m.execute_script("""const w=Services.wm.getMostRecentWindow('mail:3pane');
      w.document.getElementById('omabird-menu-button').click();
      const input=w.document.getElementById('omabird-search');
      input.value=arguments[0]; input.dispatchEvent(new w.Event('input',{bubbles:true}));""", script_args=[text])

def key(name, **kwargs):
    m.execute_script("""const w=Services.wm.getMostRecentWindow('mail:3pane');
      w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', {key:arguments[0], bubbles:true, ...arguments[1]}));""", script_args=[name, kwargs])

original = STATE.read_text()
try:
    assert str(ROOT / '.test-profile') == m.execute_script("return Services.dirsvc.get('ProfD',Ci.nsIFile).path"), 'Use the disposable profile only'
    js('Services.console.reset(); Services.prefs.setBoolPref("mailnews.mark_message_read.auto", false)')
    result = m.execute_async_script('''const done = arguments[arguments.length - 1];
      const {AddonManager} = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(arguments[0]);
      AddonManager.installTemporaryAddon(f).then(a => done({id:a.id,active:a.isActive})).catch(e => done({error:String(e)}));''', script_args=[str(ROOT / 'dist/omabird.xpi')])
    assert result.get('active'), result
    wait("return !!d.getElementById('omabird-menu-button')")
    print('PASS add-on loads')
    js('''const {MailServices}=ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
      if (!MailServices.accounts.accounts.length) MailServices.accounts.createLocalMailAccount();
      const root=MailServices.accounts.localFoldersServer.rootFolder;
      if (!root.containsChildNamed('Inbox')) root.createSubfolder('Inbox',null);
      const inbox=root.getChildNamed('Inbox');
      if (!inbox.getTotalMessages(false)) inbox.QueryInterface(Ci.nsIMsgLocalMailFolder).addMessage(
        'From - Thu Oct 01 12:00:00 2026\\nFrom: Test <test@example.invalid>\\nTo: Demo <demo@example.invalid>\\nSubject: Welcome to OmaBird\\nMessage-ID: <omabird-test@example.invalid>\\nDate: Thu, 1 Oct 2026 12:00:00 +0000\\n\\nA synthetic message for UI checks.\\n');
      w.gTabmail.openTab('mail3PaneTab', {folderURI:inbox.URI});''')
    wait("return !!w.gTabmail.currentAbout3Pane?.document.getElementById('threadTree')?._selection")
    js("const p=w.gTabmail.currentAbout3Pane; p.document.getElementById('threadTree').selectedIndex=0; p.controllers.getControllerForCommand('cmd_markAsUnread').doCommand('cmd_markAsUnread');")
    key('p', ctrlKey=True, shiftKey=True)
    assert js("return d.activeElement.id") == 'omabird-search'
    menu_query('mark as read')
    assert js("return !d.querySelector('.omabird-action').disabled")
    key('Enter')
    wait("const p=w.gTabmail.currentAbout3Pane; return !p.controllers.getControllerForCommand('cmd_markAsRead').isCommandEnabled('cmd_markAsRead')")
    print('PASS keyboard menu and real mark-read command')
    menu_query('filter this folder')
    key('Enter')
    wait("return w.gTabmail.currentAbout3Pane.document.activeElement.id === 'qfb-qs-textbox'")
    print('PASS folder filter action')
    menu_query('zzzz-no-results')
    assert js("return d.getElementById('omabird-results').textContent") == 'No matching actions'
    key('Escape')
    assert not js("return !!d.getElementById('omabird-overlay')")
    print('PASS empty results, escape and focus return')
    for name in ['tokyo-night', 'catppuccin-latte', 'vantablack']:
        subprocess.run(['python', str(ROOT / 'omabird.py'), 'sync', '--theme-file', f'/usr/share/omarchy/themes/{name}/colors.toml'], check=True, capture_output=True)
        expected = json.loads(STATE.read_text())
        wait(f"return w.getComputedStyle(d.documentElement).getPropertyValue('--oma-bg').trim() === '{expected['colors']['background']}'")
        actual = js("const p=w.gTabmail.currentAbout3Pane; return {bg:p.getComputedStyle(p.document.documentElement).getPropertyValue('--oma-bg').trim(), mode:p.getComputedStyle(p.document.documentElement).colorScheme}")
        assert actual['bg'] == expected['colors']['background'], actual
        assert actual['mode'] == expected['mode'], actual
        print('PASS live theme:', name)
    good = js("return w.getComputedStyle(d.documentElement).getPropertyValue('--oma-bg')")
    STATE.write_text('{invalid')
    time.sleep(2)
    assert js("return w.getComputedStyle(d.documentElement).getPropertyValue('--oma-bg')") == good
    print('PASS invalid palette retains last theme')
    STATE.write_text(original)
    time.sleep(2)
    js('Services.console.reset()')
    # Check that disabling the add-on cleans up global styles and event listeners.
    result = m.execute_async_script('''const done=arguments[arguments.length-1];
      const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      AddonManager.getAddonByID('omabird@local.omarchy').then(a=>a.disable()).then(()=>done(true)).catch(e=>done(String(e)));''')
    assert result is True, result
    wait("return !d.getElementById('omabird-menu-button')")
    assert js("return w.getComputedStyle(d.documentElement).getPropertyValue('--oma-bg')") == ''
    key('p', ctrlKey=True, shiftKey=True)
    assert not js("return !!d.getElementById('omabird-overlay')")
    print('PASS disable removes styles, button and shortcut')
finally:
    STATE.write_text(original)
    m.delete_session()
