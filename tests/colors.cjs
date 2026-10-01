// SPDX-License-Identifier: MIT
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {readdirSync} = require('node:fs');
const colors = require('../extension/api/mail-colors.js');
let palettes = 0, pairs = 0;
for (const theme of readdirSync('/usr/share/omarchy/themes')) {
  const file = `/usr/share/omarchy/themes/${theme}/colors.toml`;
  const result = spawnSync('omarchy-theme-color', ['--file',file,'--all'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const palette = Object.fromEntries(result.stdout.trim().split('\n').map(line=>line.split('\t')));
  if (!/^#[0-9a-f]{6}$/i.test(palette.background || '')) continue;
  const tokens = colors.mailTokens({mode:palette.mode, colors:palette});
  for (const [prefix,surface] of Object.entries({'':palette.background,'hover-':palette.lighter_background,
    'selected-':palette.selection,'header-':palette.dark_background})) {
    for (const role of ['subject','read-subject','meta','read-meta']) {
      assert.ok(colors.contrast(tokens['mail-'+prefix+role],surface)>=4.5, `${theme}: ${prefix}${role}`);
      pairs++;
    }
  }
  palettes++;
}
assert.ok(palettes>=20);
console.log(`PASS ${pairs} text/surface contrast pairs across ${palettes} Omarchy palettes`);
