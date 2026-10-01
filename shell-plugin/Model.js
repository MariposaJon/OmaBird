// SPDX-License-Identifier: MIT
function parseStatus(text) {
  try {
    var value = JSON.parse(text);
    if (value.version !== 1 || !Array.isArray(value.accounts)) return null;
    var accounts = value.accounts.filter(function(a) {
      return typeof a.key === "string" && typeof a.label === "string"
        && Number.isInteger(a.unread) && a.unread >= 0;
    });
    return { running: value.running === true, updatedAt: Number(value.updatedAt) || 0,
      total: accounts.reduce(function(n, a) { return n + a.unread; }, 0), accounts: accounts };
  } catch (e) { return null; }
}
function isLive(status, now) {
  return !!status && status.running && now - status.updatedAt >= -5000 && now - status.updatedAt < 25000;
}
function badge(total) { return total > 99 ? "99+" : String(total); }
if (typeof module !== "undefined") module.exports = {parseStatus:parseStatus,isLive:isLive,badge:badge};
