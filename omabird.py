#!/usr/bin/env python3
"""Local Omarchy palette bridge and OmaBird launcher."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
HOME = Path.home()
STATE = HOME / '.local/state/omabird'
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
                z.write(p, p.relative_to(ROOT / 'extension'))
    print(dest)
    return dest


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['sync', 'build', 'install', 'launch'])
    parser.add_argument('--theme-file')
    args, extra = parser.parse_known_args()
    if args.action == 'sync':
        sync(args.theme_file)
    elif args.action == 'build':
        build()
    elif args.action == 'install':
        install()
    else:
        sync()
        os.execvp('betterbird', ['betterbird'] + extra)

if __name__ == '__main__':
    main()
