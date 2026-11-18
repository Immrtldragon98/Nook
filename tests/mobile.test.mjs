import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import vm from 'node:vm';

function loadTs(path,dependencies={}) {
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((name)=>{
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  },module,module.exports);
  return module.exports;
}
const policy=loadTs('../src/reminderPolicy.ts');
let scheduled=new Map();
const api={
  setNotificationHandler(){},
  getPermissionsAsync:async()=>({granted:true}),
  getAllScheduledNotificationsAsync:async()=>[...scheduled].map(([identifier,request])=>({identifier,...request})),
  cancelScheduledNotificationAsync:async(id)=>{scheduled.delete(id);},
  scheduleNotificationAsync:async(request)=>{scheduled.set(request.identifier,request);},
  SchedulableTriggerInputTypes:{DATE:'date'},
};
const reminders=loadTs('../src/notifications.ts',{'react-native':{Platform:{OS:'android'}},'expo-notifications':api,'./reminderPolicy':policy});
const approved={id:'test-plan',title:'Badminton',area:'HSR',starts_at:new Date(Date.now()+86400000).toISOString(),requestStatus:'approved'};
await reminders.syncApprovedPlanReminders([approved]);
assert(scheduled.has('plan-reminder-test-plan'));
await reminders.syncApprovedPlanReminders([{...approved,requestStatus:'rejected'}]);
assert(!scheduled.has('plan-reminder-test-plan'));
await reminders.syncApprovedPlanReminders([approved]);
await reminders.syncApprovedPlanReminders([]);
assert.equal(scheduled.size,0);
const sync=reminders.syncApprovedPlanReminders([approved]);
const logout=reminders.clearPlanReminders();
await Promise.all([sync,logout]);
assert.equal(scheduled.size,0,'logout must win over an in-flight reminder sync');
scheduled.set('unrelated',{content:{}});
await reminders.syncApprovedPlanReminders([{...approved,starts_at:'invalid'},{...approved,id:'past',starts_at:'2000-01-01T00:00:00Z'}]);
assert.deepEqual([...scheduled.keys()],['unrelated']);
console.log('PASS reminders cancel after rejection, deletion and queued sign-out; invalid/past plans are ignored');

// Execute the real Expo-SQLite migration and profile functions with SQLite.
// Only the async adapter is replaced; queries and schema are unchanged.
const database=loadTs('../src/database.ts');
function adapter(native) {
  return {
    execAsync:async(sql)=>native.exec(sql),
    runAsync:async(sql,...args)=>native.prepare(sql).run(...args),
    getFirstAsync:async(sql,...args)=>native.prepare(sql).get(...args) ?? null,
  };
}
const a=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');
const dbA=adapter(a),dbB=adapter(b);
await database.migrateDatabase(dbA); await database.migrateDatabase(dbB);
await database.saveProfile(dbA,{name:'Alice',city:'Bengaluru',zone:'HSR',languages:'English',interests:'Sports',bio:'Hello'});
assert.equal(await database.getProfile(dbB),null);
await database.saveProfile(dbB,{name:'Bob',city:'Hyderabad',zone:'KPHB',languages:'Telugu',interests:'Food',bio:'Hi'});
assert.equal((await database.getProfile(dbA)).name,'Alice');
assert.equal((await database.getProfile(dbB)).name,'Bob');
assert.notEqual((await database.getProfile(dbA)).account_code,(await database.getProfile(dbB)).account_code);
await database.clearLocalAccountData(dbA);
assert.equal(await database.getProfile(dbA),null);
assert.equal((await database.getProfile(dbB)).name,'Bob');
a.close();b.close();
console.log('PASS separate account databases preserve independent profiles and connection codes');
