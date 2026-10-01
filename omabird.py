#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Local Omarchy palette bridge and OmaBird launcher."""
import argparse
import hashlib
import tarfile
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent
HOME = Path.home()
STATE = Path(os.environ.get('OMABIRD_STATE_DIR', str(HOME / '.local/state/omabird')))
ADDON_ID = 'omabird@local.omarchy'


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode='w') as f:
        f.write(data)
        tmp = Path(f.name)
    tmp.replace(path)


def palette(theme_file=None):
    command = ['omarchy-theme-color']
    if theme_file:
        command += ['--file', str(theme_file)]
    raw = subprocess.check_output(command + ['--all'], text=True)
    colors = dict(line.split('\t', 1) for line in raw.splitlines())
    needed = ['background', 'foreground', 'accent', 'selection', 'muted',
              'dark_background', 'lighter_background', 'bright_foreground',
              'red', 'green', 'yellow']
    colors['accent'] = colors.get('accent') or colors.get('blue') or colors['foreground']
    for key in needed:
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', colors.get(key, '')):
            raise ValueError(f'Invalid or missing theme color: {key}')
    font = subprocess.check_output(['omarchy', 'font', 'current'], text=True).strip()
    if len(font) > 200 or any(ord(c) < 32 for c in font):
        raise ValueError('Invalid desktop font')
    name_file = HOME / '.local/state/omarchy/current/theme.name'
    name = Path(theme_file).parent.name if theme_file else name_file.read_text().strip()
    return {'name': name, 'font': font, 'mode': 'light' if colors.get('mode') == 'light' else 'dark',
            'colors': {k: colors[k] for k in needed}}


def sync(theme_file=None):
    data = palette(theme_file)
    atomic_write(STATE / 'palette.json', json.dumps(data, indent=2) + '\n')
    # Vector icon follows the active theme, too.
    c = data['colors']
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect x="4" y="4" width="120" height="120" rx="24" fill="{c['background']}"/>
<path d="M27 41h74v51H27z M28 43l36 27 36-27" fill="none" stroke="{c['accent']}" stroke-width="6" stroke-linejoin="round"/>
<path d="M43 28l21-13 21 13M64 15v28" fill="none" stroke="{c['foreground']}" stroke-width="5" stroke-linecap="round"/>
</svg>'''
    atomic_write(HOME / '.local/share/icons/hicolor/scalable/apps/omabird.svg', svg)
    print(f'OmaBird synchronized: {data["name"]}')
    return data


def build():
    dest = ROOT / 'dist/omabird.xpi'
    dest.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT / 'extension').rglob('*')):
            if p.is_file():
                relative = p.relative_to(ROOT / 'extension')
                if str(relative) == 'api/mail-bridge.js':
                    continue
                if str(relative) == 'api/implementation.js':
                    bridge = (ROOT / 'extension/api/mail-bridge.js').read_text()
                    z.writestr(str(relative), p.read_text().replace('/* @include-mail-bridge */', bridge))
                else:
                    z.write(p, relative)
        z.write(ROOT / 'LICENSE', 'LICENSE')
    print(dest)
    return dest


def release():
    if subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain'], text=True).strip():
        raise RuntimeError('Commit source changes before packaging a release')
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    addon = json.loads((ROOT / 'extension/manifest.json').read_text())
    if manifest['version'] != addon['version']:
        raise RuntimeError('Plugin and add-on versions must match')
    version = addon['version']
    xpi = build()
    archive = ROOT / f'dist/OmaBird-{version}.tar.gz'
    subprocess.run(['git', '-C', str(ROOT), 'archive', '--format=tar.gz',
                    f'--prefix=OmaBird-{version}/', f'--output={archive}', 'HEAD'], check=True)
    with tempfile.TemporaryDirectory(prefix='omabird-release-') as folder:
        with tarfile.open(archive) as package:
            package.extractall(folder, filter='data')
        subprocess.run(['omarchy', 'plugin', 'validate', str(Path(folder) / f'OmaBird-{version}')], check=True)
    lines = [hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name for p in [xpi, archive]]
    atomic_write(ROOT / 'dist/SHA256SUMS', '\n'.join(lines) + '\n')
    print(archive)
    print(ROOT / 'dist/SHA256SUMS')


def install():
    build()
    sync()
    bindir = HOME / '.local/bin'
    bindir.mkdir(parents=True, exist_ok=True)
    launcher = '#!/bin/sh\nexec python3 ' + __import__('shlex').quote(str(ROOT / 'omabird.py')) + ' "$@"\n'
    atomic_write(bindir / 'omabird', launcher)
    (bindir / 'omabird').chmod(0o755)
    hook = ROOT / 'omabird-theme-hook'
    atomic_write(hook, '#!/bin/sh\nexec ' + __import__('shlex').quote(str(bindir / 'omabird')) + ' sync\n')
    hook.chmod(0o755)
    for event in ['theme-set', 'font-set']:
        subprocess.run(['omarchy', 'hook', 'install', event, str(hook)], check=True)
    atomic_write(HOME / '.local/share/applications/omabird.desktop', f'''[Desktop Entry]
Type=Application
Name=OmaBird
GenericName=Mail Client
Comment=Betterbird with Omarchy themes and keyboard controls
Exec={bindir}/omabird launch %u
Icon=omabird
Terminal=false
Categories=Network;Email;
Keywords=Email;Mail;Betterbird;Omarchy;
MimeType=x-scheme-handler/mailto;message/rfc822;
StartupNotify=true
StartupWMClass=eu.betterbird.Betterbird
Actions=Compose;

[Desktop Action Compose]
Name=Write new message
Exec={bindir}/omabird launch -compose
''')
    subprocess.run(['update-desktop-database', str(HOME / '.local/share/applications')], check=False)
    plugin = HOME / '.config/omarchy/plugins/local.omabird'
    plugin.mkdir(parents=True, exist_ok=True)
    if plugin.resolve() != ROOT.resolve():
        shutil.copytree(ROOT / 'shell-plugin', plugin / 'shell-plugin', dirs_exist_ok=True)
        shutil.copy2(ROOT / 'manifest.json', plugin / 'manifest.json')
        shutil.copy2(ROOT / 'LICENSE', plugin / 'LICENSE')
    subprocess.run(['omarchy', 'plugin', 'validate', str(plugin)], check=True)
    rescan = subprocess.run(['omarchy-shell', 'shell', 'rescanPlugins'], capture_output=True, text=True)
    shell_config = json.loads((HOME / '.config/omarchy/shell.json').read_text())
    layout = shell_config.get('bar', {}).get('layout', {})
    present = any(entry.get('id') == 'local.omabird'
                  for section in layout.values() if isinstance(section, list)
                  for entry in section if isinstance(entry, dict))
    if not present and rescan.returncode == 0:
        subprocess.run(['omarchy', 'plugin', 'enable', 'local.omabird', '--before', 'omarchy.tray'], check=True)
    elif rescan.returncode != 0:
        print('Plugin files installed; shell IPC is unavailable in this session.')
        if not present:
            print('Enable from the desktop: omarchy plugin enable local.omabird --before omarchy.tray')


def mail_action(action, account=None):
    if action not in ['inbox', 'search', 'commands']:
        raise ValueError('Unsupported mail action')
    request = {'id': str(uuid.uuid4()), 'issuedAt': int(time.time() * 1000), 'action': action}
    if account:
        request['account'] = account
    atomic_write(STATE / 'request.json', json.dumps(request) + '\n')
    # Betterbird activates its existing window or starts a normal session.
    subprocess.Popen(['betterbird'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['sync', 'build', 'install', 'launch', 'action', 'release'])
    parser.add_argument('--theme-file')
    parser.add_argument('--account')
    args, extra = parser.parse_known_args()
    if args.action == 'sync':
        sync(args.theme_file)
    elif args.action == 'build':
        build()
    elif args.action == 'release':
        release()
    elif args.action == 'install':
        install()
    elif args.action == 'action':
        if len(extra) != 1:
            parser.error('action requires inbox, search or commands')
        mail_action(extra[0], args.account)
    else:
        sync()
        os.execvp('betterbird', ['betterbird'] + extra)

if __name__ == '__main__':
    main()
