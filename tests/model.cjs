const assert = require('node:assert/strict');
const model = require('../shell-plugin/Model.js');
const now = Date.now();
const valid = JSON.stringify({version:1,running:true,updatedAt:now,total:999,
  accounts:[{key:'server1',label:'Demo',unread:3},{key:'server2',label:'Other',unread:2}]});
const status = model.parseStatus(valid);
assert.equal(status.total, 5); // Use validated account counts, not an arbitrary total.
assert.equal(model.isLive(status,now),true);
assert.equal(model.isLive(status,now+25000),false);
assert.equal(model.isLive({...status,running:false},now),false);
assert.equal(model.parseStatus('{invalid'),null);
assert.equal(model.parseStatus('{"version":99,"accounts":[]}'),null);
assert.equal(model.badge(100),'99+');
assert.equal(model.badge(3),'3');
console.log('PASS shell status validation, stale-state handling and badge formatting');
