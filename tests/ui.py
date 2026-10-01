# SPDX-License-Identifier: MIT
"""Run real Betterbird UI checks without network, sockets or a desktop session."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import zipfile

ROOT=Path(__file__).resolve().parents[1]
subprocess.run(['python3',str(ROOT/'omabird.py'),'build'],check=True)
with tempfile.TemporaryDirectory(prefix='omabird-ui-') as temp:
    folder=Path(temp)
    profile=folder/'profile'
    state=folder/'state'
    (profile/'extensions').mkdir(parents=True)
    state.mkdir()
    palette=json.loads((Path.home()/'.local/state/omabird/palette.json').read_text())
    (state/'palette.json').write_text(json.dumps(palette))
    (profile/'user.js').write_text('''user_pref("extensions.autoDisableScopes",0);
user_pref("extensions.enabledScopes",15);
user_pref("mail.provider.suppress_dialog_on_startup",true);
user_pref("mail.shell.checkDefaultClient",false);
user_pref("mailnews.mark_message_read.auto",false);
user_pref("datareporting.policy.dataSubmissionEnabled",false);
''')
    addon=profile/'extensions/omabird@local.omarchy.xpi'
    with zipfile.ZipFile(ROOT/'dist/omabird.xpi') as source,zipfile.ZipFile(addon,'w',zipfile.ZIP_DEFLATED) as dest:
        for name in source.namelist():
            data=source.read(name)
            if name=='api/implementation.js':
                code=data.decode().replace('  return class extends', (ROOT/'tests/ui-checks.js').read_text()+'\n  return class extends',1)
                code=code.replace('    await this.mailBridge.tick();','    await this.mailBridge.tick();\n    runOmaBirdUiChecks(this);',1)
                data=code.encode()
            dest.writestr(name,data)
    output=folder/'result.json'
    env=dict(os.environ,MOZ_HEADLESS='1',MOZ_DBUS_REMOTE='0',OMABIRD_STATE_DIR=str(state),
             OMABIRD_UI_TEST_PROFILE=str(profile),OMABIRD_UI_TEST_OUTPUT=str(output))
    log_path=folder/'app.log'
    with log_path.open('w') as log_file:
        proc=subprocess.Popen(['betterbird','--headless','--no-remote','--new-instance','--profile',str(profile)],
                              env=env,stdout=log_file,stderr=subprocess.STDOUT,start_new_session=True)
        deadline=time.monotonic()+60
        while not output.exists() and proc.poll() is None and time.monotonic()<deadline:
            time.sleep(.2)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid,signal.SIGTERM)
            proc.wait(timeout=10)
    log=log_path.read_text()
    if not output.exists():
        print(log[-7000:])
        raise SystemExit('UI test runner did not produce a report')
    result=json.loads(output.read_text())
    for check in result['checks']: print('PASS',check)
    if not result['ok']:
        print(result.get('error'));print(result.get('stack'));print(result.get('fonts',''));print(result.get('fixture',''));print(log[-2000:])
        raise SystemExit(1)
    print('PASS real Betterbird message fonts, card and table hierarchy')
