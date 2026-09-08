import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const BLOCK_REASON = "Stride task isolation: writes require the current task or a launcher-bound directory";

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function schemeQuote(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Resolve existing symlinks, including dangling links, before accepting a new file.
// Falling back to a lexical parent on ENOENT would permit link -> /outside/new.
export function canonicalPath(input, depth = 0) {
  if (depth > 40) throw new Error("symlink loop");
  const path = resolve(input);
  const parts = path.split(sep).filter(Boolean);
  let cursor = sep;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return resolve(cursor, ...parts.slice(index + 1));
    }
    if (stat.isSymbolicLink()) {
      const target = resolve(dirname(cursor), readlinkSync(cursor));
      return canonicalPath(resolve(target, ...parts.slice(index + 1)), depth + 1);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("non-directory ancestor");
  }
  return cursor;
}

function absoluteDirectory(path, name) {
  if (typeof path !== "string" || !path.trim() || !isAbsolute(path) || /[\x00-\x1f]/.test(path)) {
    throw new Error(`${name} must be an absolute directory`);
  }
  const canonical = canonicalPath(path);
  try {
    if (!lstatSync(canonical).isDirectory()) throw new Error(`${name} is not a directory`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return canonical;
}

function fixedFile(path, expected) {
  if (typeof path !== "string" || !isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error("invalid store file");
  const canonical = canonicalPath(path);
  if (!expected.includes(canonical) || resolve(path) !== canonical) throw new Error(`unexpected store file: ${path} -> ${canonical}`);
  return canonical;
}

export function createLocalPolicy({ taskRoot, home = homedir() }) {
  const root = absoluteDirectory(taskRoot, "taskRoot");
  const userHome = absoluteDirectory(home, "home");
  if (root === sep || inside(root, userHome)) throw new Error("taskRoot must not contain the user home");
  const controlDir = join(root, ".multica", "stride-runtime");
  const tempDir = join(controlDir, "tmp");
  const cacheDir = join(controlDir, "cache");
  const requestsDir = join(controlDir, "requests");
  for (const path of [controlDir, tempDir, cacheDir, requestsDir]) {
    if (!inside(root, canonicalPath(path))) throw new Error(`runtime path escapes task: ${path}`);
  }
  return Object.freeze({
    taskRoot: root, roots: Object.freeze([root]), files: Object.freeze([]),
    tempDir, cacheDir, requestsDir,
    runtimeEnv: Object.freeze({
      STRIDE_REQUESTS_DIR: requestsDir,
      TMPDIR: tempDir, XDG_CACHE_HOME: cacheDir,
      npm_config_cache: join(cacheDir, "npm"),
      PYTHONPYCACHEPREFIX: join(cacheDir, "python"),
    }),
  });
}

// Metadata comes from the trusted carrier CLI, never an editable task allowlist.
export function createPolicy({ taskRoot, metadata, home = homedir(), storeHome = join(home, ".local", "share", "stride") }) {
  const root = absoluteDirectory(taskRoot, "taskRoot");
  const userHome = absoluteDirectory(home, "home");
  if (root === sep || inside(root, userHome)) throw new Error("taskRoot must not contain the user home");
  const store = absoluteDirectory(storeHome, "storeHome");
  if (store === sep || inside(store, userHome)) throw new Error("storeHome must not contain the user home");
  if (!metadata || metadata.schema !== "stride.carrier.v1" || !/^[a-f0-9]{16}$/.test(metadata.task_id)) throw new Error("invalid carrier task identity");
  if (absoluteDirectory(metadata.store_home, "carrier store_home") !== store) throw new Error("carrier store identity mismatch");
  const task = absoluteDirectory(metadata.task_root, "carrier task_root");
  if (task !== join(store, "tasks", metadata.task_id)) throw new Error("carrier task root mismatch");
  const workspace = absoluteDirectory(metadata.workspace, "carrier workspace");
  if (!inside(task, workspace) && workspace !== root) throw new Error("carrier workspace is outside the bound task");
  const expectedFiles = ["stride.db", "stride.db-wal", "stride.db-shm", "stride.db-journal"].map((file) => join(store, file));
  if (!Array.isArray(metadata.store_files) || metadata.store_files.length > 4) throw new Error("invalid carrier store files");
  const files = [...new Set(metadata.store_files.map((file) => fixedFile(file, expectedFiles)))];
  if (!files.includes(join(store, "stride.db"))) throw new Error("carrier omitted central database");
  const gitDirs = metadata.git_common_dirs ?? [];
  if (!Array.isArray(gitDirs) || gitDirs.length > 32) throw new Error("invalid carrier git directories");
  const gitRoots = gitDirs.map((path) => {
    const gitRoot = absoluteDirectory(path, "git common directory");
    if (gitRoot === sep || inside(gitRoot, userHome) || inside(gitRoot, store) || inside(gitRoot, root)) throw new Error("git common directory is too broad");
    if (!lstatSync(join(gitRoot, "HEAD")).isFile() || !lstatSync(join(gitRoot, "objects")).isDirectory()) throw new Error("carrier git directory is not a git common directory");
    return gitRoot;
  });
  const roots = [...new Set([root, task, ...gitRoots])];
  const controlDir = join(root, ".multica", "stride-runtime");
  const tempDir = join(controlDir, "tmp");
  const cacheDir = join(controlDir, "cache");
  const requestsDir = join(controlDir, "requests");
  for (const path of [controlDir, tempDir, cacheDir, requestsDir]) {
    if (!inside(root, canonicalPath(path))) throw new Error(`runtime path escapes task: ${path}`);
  }
  return Object.freeze({
    taskRoot: root,
    taskId: metadata.task_id,
    roots: Object.freeze(roots),
    files: Object.freeze(files),
    storeHome: store,
    tempDir,
    cacheDir,
    requestsDir,
    runtimeEnv: Object.freeze({
      STRIDE_HOME: store,
      STRIDE_TASK_ID: metadata.task_id,
      STRIDE_REQUESTS_DIR: requestsDir,
      TMPDIR: tempDir,
      XDG_CACHE_HOME: cacheDir,
      npm_config_cache: join(cacheDir, "npm"),
      PYTHONPYCACHEPREFIX: join(cacheDir, "python"),
    }),
  });
}

export function writableRootVerdict(policy, inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim() || inputPath.includes("\0")) {
    return { allowed: false, resolved: null, reason: `${BLOCK_REASON}: missing path` };
  }
  let canonical;
  try { canonical = canonicalPath(resolve(policy.taskRoot, inputPath)); }
  catch { return { allowed: false, resolved: null, reason: `${BLOCK_REASON}: unresolved path` }; }
  const allowed = policy.roots.some((root) => inside(root, canonical)) || policy.files.includes(canonical);
  return { allowed, resolved: canonical, reason: allowed ? null : `${BLOCK_REASON}: ${canonical}` };
}

export function sandboxProfile(policy) {
  return [
    "(version 1)", "(deny default)", "(allow process*)", "(allow file-read*)",
    "(allow network*)", "(allow sysctl-read)", "(allow mach-lookup)", "(allow signal)",
    ...policy.roots.map((root) => `(allow file-write* (subpath "${schemeQuote(root)}"))`),
    ...policy.files.map((file) => `(allow file-write* (literal "${schemeQuote(file)}"))`),
    '(allow file-write* (literal "/dev/null"))', '(allow file-write* (literal "/dev/tty"))',
    "",
  ].join("\n");
}

export function sandboxCommand(policy, command) {
  if (typeof command !== "string") throw new Error("missing bash command");
  const env = Object.entries(policy.runtimeEnv).map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ");
  // -p embeds the fixed policy. A writable .sb file would let the model replace it.
  // No login/interactive shell: startup dotfiles must not silently select another workflow.
  return `${env} /usr/bin/sandbox-exec -p ${shellQuote(sandboxProfile(policy))} /bin/zsh -f -c ${shellQuote(command)}`;
}

export function issueIdentity(context) {
  const match = context.match(/^\*\*Issue ID:\*\* ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/m);
  if (!match) throw new Error("Runtimia issue identity is missing from issue_context.md");
  return match[1];
}

export function carrierArgs(mode, { issueId, workspaceId, runId, taskRoot }) {
  if (!/^[0-9a-f-]{36}$/.test(issueId) || typeof workspaceId !== "string" || !workspaceId || typeof runId !== "string" || !runId) throw new Error("Runtimia carrier identity is incomplete");
  return ["carrier", mode, "--issue", issueId, "--workspace", workspaceId, "--run-id", runId, "--workdir", taskRoot];
}

function carrierError(error) {
  const line = String(error.stderr ?? "").split(/\r?\n/).find((item) => item.startsWith("Stride: "));
  if (line) return line.slice(0, 400);
  if (error.code === "ETIMEDOUT") return "carrier timed out; inspect the existing issue binding before retrying";
  return String(error.message ?? error).split("\n")[0].slice(0, 400);
}

export default function registerStrideWritableRoot(pi) {
  const root = realpathSync.native(process.cwd());
  const home = homedir();
  const cli = join(home, "stride", "bin", "stride");
  const requestsDir = join(root, ".multica", "stride-runtime", "requests");
  const fixedEnv = { ...process.env, STRIDE_HOME: join(home, ".local", "share", "stride"), STRIDE_REQUESTS_DIR: requestsDir, PYTHONDONTWRITEBYTECODE: "1" };
  let identity;
  let taskId;
  let initialError;
  let localPolicy;
  const inspect = (mode) => {
    const result = execFileSync(cli, carrierArgs(mode, identity), { env: fixedEnv, encoding: "utf8", timeout: mode === "attach" ? 45_000 : 10_000, maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const metadata = JSON.parse(result);
    if (metadata.external_id !== `runtimia:${identity.workspaceId}:${identity.issueId}`) throw new Error("carrier source identity mismatch");
    const policy = createPolicy({ taskRoot: root, metadata, home });
    if (taskId && taskId !== policy.taskId) throw new Error("carrier task changed during this run");
    taskId = policy.taskId;
    return policy;
  };
  try {
    if (!inside(root, canonicalPath(requestsDir))) throw new Error("carrier request path escapes current workdir");
    let context = "";
    try { context = readFileSync(join(root, ".agent_context", "issue_context.md"), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let policy;
    if (!/^\*\*Issue ID:\*\*/m.test(context)) {
      // Chat/quick-create runs have no issue yet. Keep ordinary cwd-only tools.
      localPolicy = createLocalPolicy({ taskRoot: root, home });
      policy = localPolicy;
      delete process.env.STRIDE_TASK_ID;
      process.stderr.write("Stride carrier not applicable: no issue identity; keeping current-workdir isolation.\n");
    } else {
      identity = {
        issueId: issueIdentity(context),
        workspaceId: process.env.MULTICA_WORKSPACE_ID,
        runId: process.env.MULTICA_TASK_ID,
        taskRoot: root,
      };
      policy = inspect("attach");
    }
    for (const path of [policy.tempDir, policy.cacheDir, policy.requestsDir]) mkdirSync(path, { recursive: true, mode: 0o700 });
    Object.assign(process.env, policy.runtimeEnv);
  } catch (error) {
    initialError = `Stride carrier unavailable: ${carrierError(error)}. Read tools remain available; report this once before resuming writes.`;
    process.stderr.write(`${initialError}\n`);
  }
  pi.on("tool_call", async (event) => {
    if (!["write", "edit", "bash"].includes(event.toolName)) return undefined;
    if (initialError) return { block: true, reason: initialError, terminate: false };
    let policy;
    try { policy = localPolicy ?? inspect("inspect"); }
    catch (error) { return { block: true, reason: `Stride carrier readback failed: ${carrierError(error)}`, terminate: false }; }
    if (event.toolName === "write" || event.toolName === "edit") {
      const verdict = writableRootVerdict(policy, event.input?.path);
      if (!verdict.allowed) return { block: true, reason: verdict.reason, terminate: false };
      event.input.path = verdict.resolved;
    } else {
      if (typeof event.input?.command !== "string") return { block: true, reason: `${BLOCK_REASON}: missing bash command`, terminate: false };
      event.input.command = sandboxCommand(policy, event.input.command);
    }
    return undefined;
  });
}
