'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const deferred = () => { let reject; const promise = new Promise((_resolve, j) => { reject = j; }); return { promise, reject }; };

for (const [channel, end] of [['backup:restore', "\nipcMain.handle('workspace:open'"], ['recovery:execute', "\nipcMain.handle('recovery:rollback'"]]) {
  test(`${channel} owns the workspace lock before its first async read and releases it on failure`, async () => {
    const reads = [], preview = { root: '/fixture', operationId: 'operation', binding: '{}', expiresAt: Date.now() + 10000 };
    let handler;
    const context = { workspaceSwitching: false, requireWorkspaceOwner() {},
      backupPreviews: new Map([['preview', preview]]), recoveryPreviews: new Map([['preview', preview]]),
      PomeI18n: { t: key => key },
      ipcMain: { handle: (_name, value) => { handler = value; } },
      workspaceRoot: () => '/fixture', syncCredentialsStore: { getStatus: () => ({}) },
      recoveryStore: () => ({ read: () => ({ paused: true, operationId: 'operation' }) }),
      liveBackupStorage: () => { const job = deferred(); reads.push(job); return job.promise; },
      mainWindow: { webContents: { executeJavaScript: async () => {} } },
    };
    const start = source.indexOf(`ipcMain.handle('${channel}',`), finish = source.indexOf(end, start);
    assert(start >= 0 && finish > start);
    vm.createContext(context); vm.runInContext(source.slice(start, finish), context);
    const first = handler({}, 'preview');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.workspaceSwitching, true);
    const second = handler({}, 'preview');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads.length, 1, 'only the owner may enter asynchronous workspace reads');
    assert.equal((await second).error, 'workspace_switching');
    reads[0].reject(new Error('fixture_read_failed'));
    assert.equal((await first).ok, false);
    assert.equal(context.workspaceSwitching, false, 'failure releases the lock for a retry');
    const retry = handler({}, 'preview');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads.length, 2);
    reads[1].reject(new Error('fixture_read_failed')); await retry;
    assert.equal(context.workspaceSwitching, false);
  });
}

test('folder dialogs cannot commit over an operation that acquired the workspace while they were open', async () => {
  for (const phase of ['picker', 'confirmation']) {
    let finishDialog, root = '/original';
    const context = { workspaceSwitching: false, path, WORKSPACE_DATA_FILE: 'workspace.json',
      PomeI18n: { t: value => value }, workspaceRoot: () => root,
      showOwnedOpenDialog: () => phase === 'picker' ? new Promise(resolve => { finishDialog = resolve; }) : Promise.resolve({ filePaths: ['/target'] }),
      fs: { existsSync: () => true, readFileSync: () => '{"localStorage":{}}' }, mainWindow: {},
      dialog: { showMessageBox: () => new Promise(resolve => { finishDialog = resolve; }) },
    };
    const start = source.indexOf('async function chooseWorkspaceFolder()');
    vm.createContext(context); vm.runInContext(source.slice(start, source.indexOf('\nfunction applyFeatureServices(', start)), context);
    const job = context.chooseWorkspaceFolder(); await new Promise(resolve => setImmediate(resolve));
    context.workspaceSwitching = true; root = '/other';
    finishDialog(phase === 'picker' ? { filePaths: ['/target'] } : { response: 0 });
    assert.equal(await job, false);
    assert.equal(context.workspaceSwitching, true, 'a cancelled selector cannot release another operation lock');
  }
});
