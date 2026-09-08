import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalPath, carrierArgs, createPolicy, inside, issueIdentity, sandboxCommand, sandboxProfile, shellQuote, writableRootVerdict } from './stride-writable-root.mjs';

function fixture(t) {
  const base = canonicalPath(mkdtempSync(join(tmpdir(), 'stride-guard-test-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home');
  const taskRoot = join(home, 'runtimia', 'run-1');
  const store = join(home, '.local', 'share', 'stride');
  const task = join(store, 'tasks', '0123456789abcdef');
  const otherTask = join(store, 'tasks', 'fedcba9876543210');
  const workspace = join(task, 'workspace');
  const repo = join(home, 'business');
  for (const dir of [taskRoot, workspace, otherTask, repo]) mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet', repo]);
  writeFileSync(join(store, 'stride.db'), 'database-placeholder');
  const metadata = {
    schema: 'stride.carrier.v1', task_id: '0123456789abcdef', store_home: store, task_root: task, workspace,
    store_files: ['stride.db', 'stride.db-wal', 'stride.db-shm', 'stride.db-journal'].map((name) => join(store, name)),
    git_common_dirs: [join(repo, '.git')],
  };
  const policy = createPolicy({ taskRoot, metadata, home });
  for (const dir of [policy.tempDir, policy.cacheDir, policy.requestsDir]) mkdirSync(dir, { recursive: true });
  return { base, home, taskRoot, store, task, otherTask, workspace, repo, metadata, policy };
}

test('current workdir and bound task writable; sibling task and original checkout denied', (t) => {
  const f = fixture(t);
  for (const path of ['result.txt', join(f.workspace, 'app.js'), join(f.task, 'new-dir', 'wall.md'), join(f.repo, '.git', 'objects', 'object')]) assert.equal(writableRootVerdict(f.policy, path).allowed, true, path);
  for (const path of [join(f.otherTask, 'result.txt'), join(f.repo, 'app.js'), join(f.home, '.config', 'mms', 'settings.json'), f.taskRoot + '-sibling/new.txt']) assert.equal(writableRootVerdict(f.policy, path).allowed, false, path);
  assert.equal(inside(f.taskRoot, join(f.taskRoot, '..foo')), true);
});

test('only exact central SQLite files allowed, not the whole store', (t) => {
  const f = fixture(t);
  for (const path of f.metadata.store_files) assert.equal(writableRootVerdict(f.policy, path).allowed, true);
  for (const name of ['stride.db.backup', 'other.db', 'requests.json', 'stride.db-wal.extra']) assert.equal(writableRootVerdict(f.policy, join(f.store, name)).allowed, false);
  assert.match(sandboxProfile(f.policy), /literal ".*stride\.db-wal"/);
  assert.ok(!sandboxProfile(f.policy).includes('(subpath "' + f.store + '")'));
});

test('existing and dangling symlinks cannot redirect write/edit outside', (t) => {
  const f = fixture(t);
  symlinkSync(f.otherTask, join(f.taskRoot, 'escape'));
  symlinkSync(join(f.otherTask, 'not-created'), join(f.taskRoot, 'dangling'));
  symlinkSync(f.workspace, join(f.taskRoot, 'bound'));
  symlinkSync('loop-b', join(f.taskRoot, 'loop-a'));
  symlinkSync('loop-a', join(f.taskRoot, 'loop-b'));
  for (const path of ['escape/file', 'dangling/file', 'loop-a/file']) assert.equal(writableRootVerdict(f.policy, path).allowed, false, path);
  assert.equal(writableRootVerdict(f.policy, 'bound/file').allowed, true);
});

test('malformed or broad carrier roots cannot expand policy', (t) => {
  const f = fixture(t);
  const invalid = [
    { task_id: '../other' }, { task_root: f.otherTask }, { store_home: f.home }, { workspace: f.repo },
    { store_files: [join(f.home, '.ssh', 'config')] },
    { store_files: [...f.metadata.store_files, join(f.store, 'other.db')] },
    { git_common_dirs: [f.home] }, { git_common_dirs: [f.store] }, { git_common_dirs: [f.repo] },
  ];
  for (const patch of invalid) assert.throws(() => createPolicy({ taskRoot: f.taskRoot, home: f.home, metadata: { ...f.metadata, ...patch } }), JSON.stringify(patch));
  assert.throws(() => createPolicy({ taskRoot: f.home, home: f.home, metadata: f.metadata }));
});

test('symlink substitution of task root, SQLite file or runtime cache rejected', (t) => {
  const f = fixture(t);
  const wrongRoot = join(f.store, 'tasks', '1111111111111111');
  symlinkSync(f.otherTask, wrongRoot);
  assert.throws(() => createPolicy({ taskRoot: f.taskRoot, home: f.home, metadata: { ...f.metadata, task_id: '1111111111111111', task_root: wrongRoot } }), /task root mismatch/);
  symlinkSync(join(f.otherTask, 'wal'), join(f.store, 'stride.db-wal'));
  assert.throws(() => createPolicy({ taskRoot: f.taskRoot, home: f.home, metadata: f.metadata }), /unexpected store file/);
  unlinkSync(join(f.store, 'stride.db-wal'));
  rmSync(join(f.taskRoot, '.multica'), { recursive: true });
  symlinkSync(f.otherTask, join(f.taskRoot, '.multica'));
  assert.throws(() => createPolicy({ taskRoot: f.taskRoot, home: f.home, metadata: f.metadata }), /runtime path escapes/);
});

test('shell uses central store, task-local request/cache paths and inline profile', (t) => {
  const f = fixture(t);
  assert.equal(f.policy.runtimeEnv.STRIDE_HOME, f.store);
  assert.equal(f.policy.runtimeEnv.STRIDE_TASK_ID, f.metadata.task_id);
  for (const key of ['TMPDIR', 'XDG_CACHE_HOME', 'npm_config_cache', 'PYTHONPYCACHEPREFIX', 'STRIDE_REQUESTS_DIR']) assert.ok(inside(f.taskRoot, f.policy.runtimeEnv[key]));
  assert.equal('HOME' in f.policy.runtimeEnv, false);
  const command = sandboxCommand(f.policy, "printf '%s' '$HOME'\ntrue");
  assert.match(command, /sandbox-exec -p /);
  assert.ok(!command.includes('sandbox-exec -f'));
  assert.match(command, /zsh -f -c /);
});

test('identity is extracted from daemon field, not arbitrary prose UUID', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.equal(issueIdentity('# Issue\n\n**Issue ID:** ' + id + '\n\nBody'), id);
  assert.throws(() => issueIdentity('arbitrary uuid ' + id));
  assert.deepEqual(carrierArgs('attach', { issueId: id, workspaceId: 'workspace', runId: 'run', taskRoot: '/task' }), ['carrier', 'attach', '--issue', id, '--workspace', 'workspace', '--run-id', 'run', '--workdir', '/task']);
});

const onMac = process.platform === 'darwin';
function shell(f, command) {
  return spawnSync('/bin/zsh', ['-f', '-c', sandboxCommand(f.policy, command)], { encoding: 'utf8', cwd: f.taskRoot, timeout: 15_000 });
}

test('real macOS shell permits task artifacts but denies sibling, checkout and HOME', { skip: !onMac }, (t) => {
  const f = fixture(t);
  const target = join(f.workspace, 'allowed.txt');
  const ok = shell(f, 'printf allowed > ' + shellQuote(target) + '; printf cache > "$XDG_CACHE_HOME/cache.txt"');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readFileSync(target, 'utf8'), 'allowed');
  for (const denied of [join(f.otherTask, 'denied.txt'), join(f.repo, 'denied.txt'), join(f.home, 'denied.txt')]) {
    const result = shell(f, 'printf denied > ' + shellQuote(denied));
    assert.notEqual(result.status, 0, denied);
    assert.match(result.stderr, /not permitted|denied/i);
  }
});

test('real macOS shell rejects symlink escape, forged profile and inline env', { skip: !onMac }, (t) => {
  const f = fixture(t);
  symlinkSync(f.otherTask, join(f.taskRoot, 'escape'));
  const result = shell(f, "printf '(version 1)(allow default)' > forged.sb; STRIDE_HOME=.. printf escaped > escape/denied.txt");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not permitted|denied/i);
});

test('real macOS shell updates central SQLite WAL and bound git metadata', { skip: !onMac }, (t) => {
  const f = fixture(t);
  rmSync(join(f.store, 'stride.db'));
  const sqlite = shell(f, 'sqlite3 ' + shellQuote(join(f.store, 'stride.db')) + " 'PRAGMA journal_mode=WAL; CREATE TABLE t(v); INSERT INTO t VALUES(1); SELECT v FROM t;'");
  assert.equal(sqlite.status, 0, sqlite.stderr);
  assert.match(sqlite.stdout, /wal\n1/);
  const git = shell(f, 'git --git-dir=' + shellQuote(join(f.repo, '.git')) + ' config stride.guard tested');
  assert.equal(git.status, 0, git.stderr);
  assert.equal(execFileSync('git', ['--git-dir', join(f.repo, '.git'), 'config', 'stride.guard'], { encoding: 'utf8' }).trim(), 'tested');
});

function extensionProbe(f, { failure = false, noIssue = false } = {}) {
  const issue = '11111111-2222-4333-8444-555555555555';
  const workspace = '66666666-7777-4888-8999-000000000000';
  const run = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const metadata = { ...f.metadata, external_id: 'runtimia:' + workspace + ':' + issue };
  const cli = join(f.home, 'stride', 'bin', 'stride');
  mkdirSync(join(f.home, 'stride', 'bin'), { recursive: true });
  mkdirSync(join(f.taskRoot, '.agent_context'));
  writeFileSync(join(f.taskRoot, '.agent_context', 'issue_context.md'), noIssue ? '# Chat context\n' : '**Issue ID:** ' + issue + '\n');
  const calls = join(f.taskRoot, 'carrier-calls.jsonl');
  const body = failure
    ? "process.stderr.write('Stride: Runtimia issue 读取失败；检查当前 task 的授权和连接，不回退 Owner 账号\\n'); process.exit(1);"
    : 'process.stdout.write(JSON.stringify(' + JSON.stringify(metadata) + '));';
  writeFileSync(cli, '#!' + process.execPath + '\nconst fs=require("node:fs");fs.appendFileSync(' + JSON.stringify(calls) + ',JSON.stringify(process.argv.slice(2))+"\\n");' + body + '\n', { mode: 0o755 });
  const extension = new URL('./stride-writable-root.mjs', import.meta.url).href;
  const script = [
    'import register from ' + JSON.stringify(extension) + ';',
    'let handler; register({on(name, fn){ handler=fn }});',
    'const allowed={toolName:"write",input:{path:' + JSON.stringify(join(noIssue ? f.taskRoot : f.workspace, 'ok.txt')) + '}};',
    'const denied={toolName:"edit",input:{path:' + JSON.stringify(join(f.otherTask, 'no.txt')) + '}};',
    'const first=await handler(allowed); const second=await handler(denied);',
    'const read=await handler({toolName:"read",input:{path:"README.md"}});',
    // A model can alter its context file but the extension retains launch identity.
    'const fs=await import("node:fs");fs.writeFileSync(".agent_context/issue_context.md","**Issue ID:** 11111111-1111-1111-1111-111111111111\\n");',
    'const bash={toolName:"bash",input:{command:"true"}};const third=await handler(bash);',
    'process.stdout.write(JSON.stringify({first,second,read,third,path:allowed.input.path,bash:bash.input.command,home:process.env.STRIDE_HOME,task:process.env.STRIDE_TASK_ID}));',
  ].join('\n');
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15_000, cwd: f.taskRoot,
    env: { ...process.env, HOME: f.home, MULTICA_WORKSPACE_ID: workspace, MULTICA_TASK_ID: run },
  });
  assert.equal(probe.status, 0, probe.stderr);
  return { result: JSON.parse(probe.stdout), calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [], stderr: probe.stderr, issue };
}

test('extension attaches once, refreshes fixed issue for tools and retains task identity', (t) => {
  const f = fixture(t);
  const probe = extensionProbe(f);
  assert.equal(probe.result.first, undefined);
  assert.equal(probe.result.second.block, true);
  assert.equal(probe.result.third, undefined);
  assert.equal(probe.result.read, undefined);
  assert.equal(probe.result.home, f.store);
  assert.equal(probe.result.task, f.metadata.task_id);
  assert.match(probe.result.bash, /sandbox-exec -p /);
  assert.deepEqual(probe.calls.map((args) => args[1]), ['attach', 'inspect', 'inspect', 'inspect']);
  for (const args of probe.calls) assert.equal(args[3], probe.issue);
});

test('carrier failure blocks writes once and leaves read tools available without retry loops', (t) => {
  const f = fixture(t);
  const probe = extensionProbe(f, { failure: true });
  assert.equal(probe.result.first.block, true);
  assert.equal(probe.result.second.block, true);
  assert.equal(probe.result.third.block, true);
  assert.equal(probe.result.read, undefined);
  assert.equal(probe.calls.length, 1);
  assert.match(probe.result.first.reason, /Runtimia issue 读取失败/);
  assert.match(probe.stderr, /Read tools remain available/);
});


test('non-issue chat/quick-create retains cwd-only writes and bash without carrier attach or new store', (t) => {
  const f = fixture(t);
  const probe = extensionProbe(f, { noIssue: true });
  assert.equal(probe.result.first, undefined);
  assert.equal(probe.result.second.block, true);
  assert.equal(probe.result.third, undefined);
  assert.equal(probe.result.read, undefined);
  assert.equal(probe.result.task, undefined);
  assert.equal(probe.calls.length, 0);
  assert.match(probe.result.bash, /sandbox-exec -p /);
  assert.match(probe.stderr, /carrier not applicable/);
  assert.equal(existsSync(join(f.taskRoot, '.stride')), false);
});
