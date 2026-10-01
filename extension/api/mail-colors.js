// SPDX-License-Identifier: MIT
var OmaBirdColors = (() => {
  function mix(a, b, amount) {
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount)
      + parseInt(b.slice(i, i + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
  }
  function luminance(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function readable(candidate, background) {
    const anchor = contrast('#ffffff', background) > contrast('#000000', background) ? '#ffffff' : '#000000';
    for (let step = 0; step <= 100; step++) {
      const color = mix(candidate, anchor, step / 100);
      if (contrast(color, background) >= 4.5) return color;
    }
    return anchor;
  }
  function mailTokens(data) {
    const dark = data.mode === 'dark';
    const candidates = {
      subject: dark ? '#ffffff' : '#181818',
      'read-subject': dark ? '#c7c7c7' : '#454545',
      meta: dark ? '#b5b5b5' : '#595959',
      'read-meta': dark ? '#969696' : '#666666',
    };
    const surfaces = {'': data.colors.background, 'hover-': data.colors.lighter_background,
      'selected-': data.colors.selection, 'header-': data.colors.dark_background};
    const result = {};
    for (const [prefix, background] of Object.entries(surfaces)) {
      for (const [role, candidate] of Object.entries(candidates)) {
        result['mail-' + prefix + role] = readable(candidate, background);
      }
    }
    return result;
  }
  return {mix, luminance, contrast, readable, mailTokens};
})();
if (typeof module !== 'undefined') module.exports = OmaBirdColors;
