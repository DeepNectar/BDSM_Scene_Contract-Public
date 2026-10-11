const fs = require('fs');
const src = fs.readFileSync('tests/test_cross_device_sync.js','utf8')
  .replace("check('device B: SAME text field value synced'", "console.log('DBG inputsB:', JSON.stringify(valsB)); check('device B: SAME text field value synced'")
  .replace("check('device B: refresh pulled newest field value'", "console.log('DBG st has?', !!(st && Object.values(st.fields).includes('Added: feathers & ice')), 'count', st&&Object.keys(st.fields).length); check('device B: refresh pulled newest field value'")
  .replace("check('server: deleted day removed from cloud list'", "console.log('DBG daysAfterDel:', JSON.stringify(daysAfterDel.map(d=>d.id))); check('server: deleted day removed from cloud list'");
fs.writeFileSync('dbg_sync_run_tmp.js', src);
