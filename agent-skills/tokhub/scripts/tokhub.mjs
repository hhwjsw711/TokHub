#!/usr/bin/env node
import { access, chmod, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(SCRIPT_DIR);
const SESSION_DIR = process.env.TOKHUB_SESSION_DIR || join(homedir(), ".tokhub", "sessions");
const DEFAULT_PROFILE = process.env.TOKHUB_PROFILE || "default";
const SESSION_VERSION = 1;
const ADMIN_AGENT_TOKEN = process.env.TOKHUB_ADMIN_AGENT_TOKEN || "";
const ALLOW_REPO_OUTPUT_ENV = process.env.TOKHUB_ALLOW_REPO_OUTPUT === "1";
const ALLOWED_COOKIE_NAMES = new Set(["tokhub_session", "tokhub_csrf"]);

const SENSITIVE_FIELD_NAMES = new Set([
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "csrf",
  "csrftoken",
  "gatewaykey",
  "gateway_key",
  "plainkey",
  "plain_key",
  "plaintoken",
  "plain_token",
  "plainruntimekey",
  "plain_runtime_key",
  "providerkey",
  "provider_key",
  "runtimekey",
  "runtime_key",
  "secret",
  "secretkey",
  "secret_key",
  "session",
  "sessioncookie",
  "sitekey",
  "site_key",
  "token",
  "tokenplaintext",
  "token_plaintext",
  "tokhub_csrf",
  "tokhub_session",
  "password",
  "currentpassword",
  "current_password",
  "newpassword",
  "new_password",
  "oldpassword",
  "old_password",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "privatekey",
  "private_key",
  "key",
]);

const ALLOWED_REQUEST_PREFIXES = [
  "/api/public/",
  "/v1/status/",
  "/api/me/",
  "/api/console/",
  "/api/admin/",
];

function fail(message, code = 1) {
  console.error(`FAIL: ${redactSensitiveString(String(message))}`);
  process.exit(code);
}

function usage() {
  console.log(`Usage:
  tokhub.mjs login --url https://host [--profile default] [--identifier user@example.com]
  tokhub.mjs whoami [--profile default]
  tokhub.mjs preflight [--profile default]
  tokhub.mjs workspaces list [--profile default]
  tokhub.mjs workspaces use <org-id> [--profile default]
  tokhub.mjs request METHOD /api/path [--profile default] [--url https://host] [--workspace org-id] [--site-key-env ENV_VAR] [--execute] [--reason "..."] [--idempotency-key "..."] [--json '{"ok":true}'] [--body file.json] [--form key=value] [--form-file field=path] [--output file] [--overwrite] [--allow-repo-output]
  tokhub.mjs logout [--profile default]
  tokhub.mjs admin-agent bootstrap [--url https://host] [--identifier owner@example.com] [--token-name codex-local] [--scopes admin:*] [--ttl-hours 24] [--save-env ~/.tokhub/admin-agent.env] [--overwrite] [--allow-repo-output]
  tokhub.mjs admin-agent preflight
  tokhub.mjs admin-agent request METHOD /api/admin/path [--execute] [--reason "..."] [--idempotency-key "..."] [--json '{"ok":true}'] [--body file.json] [--form key=value] [--form-file field=path] [--output file] [--overwrite] [--allow-repo-output]
  tokhub.mjs admin-agent audit-verify [--token-id aat_...] [--idempotency-key key] [--limit 500]
  tokhub.mjs catalog-check
  tokhub.mjs redact-self-test
`);
}

function parseOptions(argv) {
  const positional = [];
  const options = {};
  const repeatable = new Set(["form", "form-file"]);
  const booleanOptions = new Set(["allow-repo-output", "execute", "help", "overwrite"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq > 2 ? arg.slice(2, eq) : arg.slice(2);
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    let value = eq > 2 ? arg.slice(eq + 1) : argv[i + 1];
    if (value === undefined || (eq <= 2 && value.startsWith("--"))) {
      fail(`missing value for --${key}`);
    }
    if (repeatable.has(key)) {
      options[key] ||= [];
      options[key].push(value);
    } else {
      options[key] = value;
    }
    if (eq <= 2) {
      i += 1;
    }
  }
  return { positional, options };
}

function profileName(options) {
  const name = String(options.profile || DEFAULT_PROFILE).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) {
    fail("--profile must be 1-80 characters using letters, numbers, dot, underscore, or dash");
  }
  return name;
}

function profilePath(options) {
  return join(SESSION_DIR, `${profileName(options)}.json`);
}

function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value));
}

function normalizeBaseURL(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    fail("--url, TOKHUB_URL, TOKHUB_ADMIN_URL, or TOKHUB_BASE_URL is required");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`invalid TokHub URL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("TokHub URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    fail("TokHub URL must not include username or password");
  }
  return parsed.origin.replace(/\/+$/, "");
}

function normalizeAdminAgentBaseURL() {
  const raw = process.env.TOKHUB_BASE_URL || "";
  if (!String(raw).trim()) {
    fail("TOKHUB_BASE_URL is required for admin-agent commands");
  }
  return normalizeBaseURL(raw);
}

function tokhubURLFromOptions(options) {
  return options.url || options["base-url"] || options["admin-url"] || process.env.TOKHUB_URL || process.env.TOKHUB_ADMIN_URL || process.env.TOKHUB_BASE_URL || "";
}

function createMutedOutput() {
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!output.muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    },
  });
  output.muted = false;
  return output;
}

async function promptCredentials(options, label = "TokHub", { admin = false } = {}) {
  const rawURL = tokhubURLFromOptions(options);
  let identifier = options.identifier || process.env.TOKHUB_IDENTIFIER || process.env.TOKHUB_EMAIL || "";
  let password = process.env.TOKHUB_PASSWORD || "";
  if (admin) {
    identifier ||= process.env.TOKHUB_ADMIN_IDENTIFIER || process.env.TOKHUB_ADMIN_EMAIL || "";
    password ||= process.env.TOKHUB_ADMIN_PASSWORD || "";
  }
  if (rawURL && identifier && password) {
    return { rawURL, identifier, password };
  }
  if (!process.stdin.isTTY) {
    fail("missing login input; provide --url, --identifier, and TOKHUB_PASSWORD in non-interactive mode");
  }
  const output = createMutedOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const nextURL = rawURL || (await rl.question(`${label} URL: `));
    if (!identifier) {
      identifier = (await rl.question("Username/email: ")).trim();
    }
    if (!password) {
      process.stdout.write("Password: ");
      output.muted = true;
      password = await rl.question("");
      output.muted = false;
      process.stdout.write("\n");
    }
    return { rawURL: nextURL, identifier, password };
  } finally {
    output.muted = false;
    rl.close();
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }
  return raw.split(/,(?=\s*[^;,=\s]+=)/g);
}

function storeCookies(jar, headers) {
  for (const raw of setCookieValues(headers)) {
    const pair = raw.split(";")[0]?.trim();
    if (!pair) {
      continue;
    }
    const index = pair.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!ALLOWED_COOKIE_NAMES.has(name) || hasControlChars(name) || hasControlChars(value) || value.includes(";")) {
      continue;
    }
    jar.set(name, value);
  }
}

function sessionJar(session) {
  return new Map(Array.isArray(session.cookies) ? session.cookies : []);
}

function persistJar(session, jar) {
  session.cookies = [...jar.entries()];
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function ensureSessionDir() {
  try {
    const info = await lstat(SESSION_DIR);
    if (info.isSymbolicLink()) {
      fail(`session directory must not be a symlink: ${SESSION_DIR}`);
    }
    if (!info.isDirectory()) {
      fail(`session directory is not a directory: ${SESSION_DIR}`);
    }
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
}

async function saveSession(options, session) {
  session.updatedAt = new Date().toISOString();
  const text = `${JSON.stringify(session, null, 2)}\n`;
  const path = profilePath(options);
  await assertRepoOutputAllowed(resolve(path), "session profile", ALLOW_REPO_OUTPUT_ENV, true);
  await ensureSessionDir();
  await writeProtectedFile(path, text, {
    mode: 0o600,
    overwrite: true,
    label: "session profile",
    allowRepoOutput: ALLOW_REPO_OUTPUT_ENV,
    protectRepo: true,
  });
}

async function loadSession(options) {
  const path = profilePath(options);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail(`profile ${profileName(options)} is not logged in; run tokhub.mjs login --url https://host --profile ${profileName(options)}`);
  }
  const session = JSON.parse(text);
  if (session.version !== SESSION_VERSION || !session.baseUrl) {
    fail(`profile ${profileName(options)} has an unsupported session format`);
  }
  return session;
}

function isSensitiveField(key) {
  return SENSITIVE_FIELD_NAMES.has(String(key).replace(/[-_]/g, "").toLowerCase()) ||
    SENSITIVE_FIELD_NAMES.has(String(key).toLowerCase());
}

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (isSensitiveField(key)) {
      return [key, "[REDACTED]"];
    }
    return [key, redactSensitive(item)];
  }));
}

function redactSensitiveString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-th-[A-Za-z0-9._-]+/g, "sk-th-[REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]{20,}/g, "sk-[REDACTED]")
    .replace(/aat_[A-Za-z0-9._-]+/g, "aat_[REDACTED]")
    .replace(/tokhub_session=[^;\s]+/g, "tokhub_session=[REDACTED]")
    .replace(/tokhub_csrf=[^;\s]+/g, "tokhub_csrf=[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|site[_-]?key|secret|token|password|cookie|csrf)["']?\s*[:=]\s*)["']?[^"',\s}]+["']?/gi, "$1[REDACTED]");
}

function redactHeaders(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === "authorization" || key.toLowerCase() === "set-cookie") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function isTextContent(contentType) {
  const type = contentType.toLowerCase();
  return type.startsWith("text/") || type.includes("csv") || type.includes("yaml") || type.includes("xml");
}

function isReadMethod(method) {
  return method === "GET" || method === "HEAD";
}

function parseAssignment(raw, flag) {
  const index = String(raw).indexOf("=");
  if (index <= 0) {
    fail(`${flag} must use field=value syntax`);
  }
  return [String(raw).slice(0, index), String(raw).slice(index + 1)];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseTTLHours(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 24;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) {
    fail("--ttl-hours must be an integer between 1 and 720");
  }
  return parsed;
}

function normalizeRequestPath(path) {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/")) {
    fail(`request path must start with /, got ${raw || "<empty>"}`);
  }
  assertSafeAPIPath(raw);
  if (!ALLOWED_REQUEST_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
    fail(`unsupported TokHub API path: ${raw}`);
  }
  if (raw.startsWith("/api/admin/agent-tokens")) {
    fail("generic requests cannot manage admin-agent tokens; use tokhub.mjs admin-agent bootstrap or the owner browser UI");
  }
  return raw;
}

function assertSafeAPIPath(raw) {
  if (hasControlChars(raw)) {
    fail("request path must not contain control characters");
  }
  if (raw.startsWith("//") || raw.includes("\\")) {
    fail("request path must be a same-origin API path");
  }
  const pathPart = raw.split(/[?#]/)[0];
  const segments = pathPart.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail("request path must not contain dot segments");
  }
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    fail("request path contains invalid percent encoding");
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..") || decoded.includes("\\")) {
    fail("request path must not contain encoded dot segments");
  }
}

function pathOnly(path) {
  return String(path).split("?")[0];
}

function isArtifactPath(path) {
  const clean = pathOnly(path);
  return clean.endsWith("/export") || clean.endsWith("/download");
}

function isSecretArtifactPath(path) {
  const clean = pathOnly(path);
  return clean.endsWith("/channels/export") || (clean.includes("/channel-sites/") && clean.endsWith("/download"));
}

function needsExecutionGuard(method, path) {
  return !isReadMethod(method) || isArtifactPath(path);
}

function statusSiteKey(path, options) {
  if (!path.startsWith("/v1/status/")) {
    return "";
  }
  const envName = String(options["site-key-env"] || "").trim();
  if (!envName) {
    fail("/v1/status/* requires --site-key-env ENV_VAR; store the Site Key in a local environment variable, not in chat or shell history");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(envName)) {
    fail("--site-key-env must be a valid environment variable name");
  }
  const value = process.env[envName] || "";
  if (!value) {
    fail(`environment variable ${envName} is empty or missing`);
  }
  return value;
}

async function readRequestBody(options) {
  const usesJSON = Boolean(options.json || options.body);
  const usesForm = Boolean(options.form || options["form-file"]);
  if (usesJSON && usesForm) {
    fail("use JSON body options or form options, not both");
  }
  if (options.json) {
    JSON.parse(options.json);
    return { body: options.json, contentType: "application/json" };
  }
  if (options.body) {
    const text = await readFile(options.body, "utf8");
    JSON.parse(text);
    return { body: text, contentType: "application/json" };
  }
  if (usesForm) {
    const form = new FormData();
    for (const raw of options.form || []) {
      const [field, value] = parseAssignment(raw, "--form");
      form.set(field, value);
    }
    for (const raw of options["form-file"] || []) {
      const [field, filePath] = parseAssignment(raw, "--form-file");
      const data = await readFile(filePath);
      form.set(field, new Blob([data]), basename(filePath));
    }
    return { body: form, contentType: "" };
  }
  return { body: undefined, contentType: "" };
}

async function findGitRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    try {
      await access(join(dir, ".git"), fsConstants.F_OK);
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return "";
      }
      dir = parent;
    }
  }
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function assertNoSymlink(path, label) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      fail(`${label} must not be a symlink: ${path}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function assertRepoOutputAllowed(target, label, allowRepoOutput, protectRepo) {
  if (protectRepo && !allowRepoOutput && !ALLOW_REPO_OUTPUT_ENV) {
    const repoRoot = await findGitRoot();
    if (repoRoot && isWithin(repoRoot, target)) {
      fail(`${label} must not be written inside the current git worktree; choose a path under ~/.tokhub or pass --allow-repo-output for disposable test data`);
    }
  }
}

async function prepareProtectedPath(path, { label, allowRepoOutput, protectRepo }) {
  if (!path || hasControlChars(path)) {
    fail(`${label} path is invalid`);
  }
  const target = resolve(path);
  await assertRepoOutputAllowed(target, label, allowRepoOutput, protectRepo);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const realParent = await realpath(dirname(target));
  const realTarget = resolve(realParent, basename(target));
  await assertRepoOutputAllowed(realTarget, label, allowRepoOutput, protectRepo);
  await assertNoSymlink(target, label);
  return realTarget;
}

async function writeProtectedFile(path, data, { mode = 0o600, overwrite = false, label = "output file", allowRepoOutput = false, protectRepo = false } = {}) {
  const target = await prepareProtectedPath(path, { label, allowRepoOutput, protectRepo });
  let handle;
  try {
    handle = await open(target, overwrite ? "w" : "wx", mode);
    await handle.writeFile(data);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(`${label} already exists: ${target}; pass --overwrite to replace it`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  await chmod(target, mode);
  return target;
}

async function fetchWithSession(session, path, init = {}) {
  const jar = sessionJar(session);
  const headers = new Headers(init.headers || {});
  headers.set("Accept", headers.get("Accept") || "application/json");
  const cookie = cookieHeader(jar);
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  if (init.csrfToken) {
    headers.set("X-CSRF-Token", init.csrfToken);
  }
  if (init.contentType) {
    headers.set("Content-Type", init.contentType);
  }
  if (init.workspaceId && shouldAttachWorkspace(path)) {
    headers.set("X-TokHub-Workspace", init.workspaceId);
  }
  const response = await fetch(`${session.baseUrl}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body,
  });
  storeCookies(jar, response.headers);
  persistJar(session, jar);
  const contentType = response.headers.get("content-type") || "";
  const raw = Buffer.from(await response.arrayBuffer());
  let body = raw.toString("utf8");
  let json = false;
  if (contentType.includes("application/json") || body.trim().startsWith("{") || body.trim().startsWith("[")) {
    json = true;
    body = body.trim() ? JSON.parse(body) : {};
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.error?.code || response.statusText;
    const error = new Error(`HTTP ${response.status} ${response.statusText} for ${path}: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { response, body, raw, contentType, json };
}

function shouldAttachWorkspace(path) {
  const clean = pathOnly(path);
  return clean.startsWith("/api/console") || clean.startsWith("/api/me/private-channels");
}

async function refreshCSRF(session) {
  const csrf = await fetchWithSession(session, "/api/auth/csrf");
  if (!csrf.body?.csrfToken) {
    fail("CSRF token was not returned by TokHub");
  }
  session.csrfToken = csrf.body.csrfToken;
  return session.csrfToken;
}

async function sessionRequest(session, path, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  if (isReadMethod(method)) {
    return fetchWithSession(session, path, init);
  }
  if (!session.csrfToken) {
    await refreshCSRF(session);
  }
  try {
    return await fetchWithSession(session, path, { ...init, method, csrfToken: session.csrfToken });
  } catch (error) {
    if (error?.body?.error?.code === "csrf_invalid") {
      await refreshCSRF(session);
      return fetchWithSession(session, path, { ...init, method, csrfToken: session.csrfToken });
    }
    throw error;
  }
}

async function login(options) {
  const inputs = await promptCredentials(options, "TokHub");
  const baseUrl = normalizeBaseURL(inputs.rawURL);
  if (!String(inputs.identifier || "").trim()) {
    fail("username/email is required");
  }
  if (!inputs.password) {
    fail("password is required");
  }
  const session = {
    version: SESSION_VERSION,
    baseUrl,
    profile: profileName(options),
    cookies: [],
    csrfToken: "",
    user: null,
    workspaceId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await refreshCSRF(session);
  const loginResult = await sessionRequest(session, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: inputs.identifier.trim(), email: inputs.identifier.trim(), password: inputs.password }),
    contentType: "application/json",
  });
  session.user = loginResult.body.user || null;
  try {
    const settings = await fetchWithSession(session, "/api/console/settings");
    session.workspaceId = settings.body?.workspace?.orgId || "";
  } catch {
    session.workspaceId = "";
  }
  await saveSession(options, session);
  console.log(JSON.stringify({
    ok: true,
    profile: session.profile,
    baseUrl,
    user: redactSensitive(session.user),
    workspaceId: session.workspaceId || null,
    sessionFile: profilePath(options),
  }, null, 2));
}

async function loadAndRefreshUser(options) {
  const session = await loadSession(options);
  const me = await fetchWithSession(session, "/api/auth/me");
  session.user = me.body.user || null;
  await saveSession(options, session);
  return session;
}

function isPlatformAdmin(user) {
  return user?.role === "owner" || user?.role === "admin";
}

async function whoami(options) {
  const session = await loadAndRefreshUser(options);
  let consoleState = null;
  try {
    const settings = await fetchWithSession(session, "/api/console/settings", { workspaceId: session.workspaceId });
    consoleState = {
      activeWorkspace: settings.body.workspace || null,
      workspaces: settings.body.workspaces || [],
    };
    if (!session.workspaceId && settings.body.workspace?.orgId) {
      session.workspaceId = settings.body.workspace.orgId;
      await saveSession(options, session);
    }
  } catch (error) {
    consoleState = { error: error.message };
  }
  console.log(JSON.stringify({
    ok: true,
    profile: profileName(options),
    baseUrl: session.baseUrl,
    user: redactSensitive(session.user),
    platformAdmin: isPlatformAdmin(session.user),
    workspaceId: session.workspaceId || null,
    console: redactSensitive(consoleState),
  }, null, 2));
}

async function preflight(options) {
  const session = await loadAndRefreshUser(options);
  const health = await fetch(`${session.baseUrl}/healthz`);
  if (!health.ok) {
    fail(`healthz failed with HTTP ${health.status}`);
  }
  let consoleStatus = { ok: false };
  try {
    const settings = await fetchWithSession(session, "/api/console/settings", { workspaceId: session.workspaceId });
    consoleStatus = {
      ok: true,
      activeWorkspace: settings.body.workspace?.orgId || null,
      activeRole: settings.body.workspace?.role || null,
      workspaces: Array.isArray(settings.body.workspaces) ? settings.body.workspaces.length : 0,
    };
    if (settings.body.workspace?.orgId) {
      session.workspaceId = settings.body.workspace.orgId;
      await saveSession(options, session);
    }
  } catch (error) {
    consoleStatus = { ok: false, error: error.message };
  }
  let adminStatus = { ok: false, skipped: "not_platform_admin" };
  if (isPlatformAdmin(session.user)) {
    try {
      const admin = await fetchWithSession(session, "/api/admin/production-health");
      adminStatus = { ok: true, keys: Object.keys(admin.body || {}) };
    } catch (error) {
      adminStatus = { ok: false, error: error.message };
    }
  }
  console.log(JSON.stringify({
    ok: true,
    profile: profileName(options),
    baseUrl: session.baseUrl,
    healthz: await health.json(),
    user: redactSensitive(session.user),
    console: consoleStatus,
    admin: adminStatus,
  }, null, 2));
}

async function workspaces(command, positional, options) {
  const session = await loadAndRefreshUser(options);
  if (command === "list") {
    const settings = await fetchWithSession(session, "/api/console/settings", { workspaceId: session.workspaceId });
    if (!session.workspaceId && settings.body.workspace?.orgId) {
      session.workspaceId = settings.body.workspace.orgId;
      await saveSession(options, session);
    }
    console.log(JSON.stringify({
      ok: true,
      activeWorkspace: settings.body.workspace || null,
      workspaces: settings.body.workspaces || [],
    }, null, 2));
    return;
  }
  if (command === "use") {
    const orgID = String(positional[2] || "").trim();
    if (!orgID) {
      fail("workspaces use requires <org-id>");
    }
    const settings = await fetchWithSession(session, "/api/console/settings", { workspaceId: orgID });
    session.workspaceId = settings.body.workspace?.orgId || orgID;
    await saveSession(options, session);
    console.log(JSON.stringify({
      ok: true,
      activeWorkspace: settings.body.workspace || { orgId: session.workspaceId },
    }, null, 2));
    return;
  }
  fail(`unknown workspaces command: ${command || "<empty>"}`);
}

async function request(method, path, options) {
  method = String(method || "").toUpperCase();
  if (!method || !path) {
    fail("request requires METHOD and /api/path");
  }
  path = normalizeRequestPath(path);
  const guarded = needsExecutionGuard(method, path);
  const reason = options.reason || process.env.TOKHUB_AGENT_REASON || "";
  const idempotencyKey = options["idempotency-key"] || process.env.TOKHUB_IDEMPOTENCY_KEY || "";
  if (guarded && !options.execute) {
    console.log(JSON.stringify({
      blocked: true,
      reason: "write_or_export_requires_execute",
      method,
      path,
      requiredFlags: ["--execute", "--reason", "--idempotency-key"],
    }, null, 2));
    process.exit(2);
  }
  if (guarded && reason.trim().length < 3) {
    fail("--reason is required for write, export, download, or other guarded operations");
  }
  if (guarded && !/^\S{8,120}$/.test(idempotencyKey)) {
    fail("--idempotency-key must be 8-120 non-space characters for guarded operations");
  }
  const publicOnly = path.startsWith("/api/public/") || path.startsWith("/v1/status/");
  let session;
  let saveAfter = false;
  if (publicOnly && options.url) {
    session = { version: SESSION_VERSION, baseUrl: normalizeBaseURL(options.url), cookies: [], csrfToken: "", user: null, workspaceId: "" };
  } else {
    session = await loadAndRefreshUser(options);
    saveAfter = true;
  }
  if (path.startsWith("/api/admin/") && !isPlatformAdmin(session.user)) {
    fail("current profile is not a platform owner/admin; admin routes are not available");
  }
  const requestBody = await readRequestBody(options);
  const headers = new Headers();
  if (requestBody.contentType) {
    headers.set("Content-Type", requestBody.contentType);
  }
  if (reason) {
    headers.set("X-TokHub-Agent-Reason", reason);
  }
  if (idempotencyKey) {
    headers.set("X-Idempotency-Key", idempotencyKey);
  }
  const siteKey = statusSiteKey(path, options);
  if (siteKey) {
    headers.set("X-Site-Key", siteKey);
  }
  if (!options.output && isArtifactPath(path)) {
    fail(`${pathOnly(path)} returns export or package content and requires --output`);
  }
  const workspaceId = options.workspace || session.workspaceId || "";
  const result = await sessionRequest(session, path, {
    method,
    headers,
    body: requestBody.body,
    workspaceId,
  });
  if (saveAfter) {
    await saveSession(options, session);
  }
  if (options.output) {
    const output = result.json
      ? Buffer.from(`${JSON.stringify(redactSensitive(result.body), null, 2)}\n`, "utf8")
      : result.raw;
    const outputPath = await writeProtectedFile(options.output, output, {
      mode: 0o600,
      overwrite: Boolean(options.overwrite),
      label: isSecretArtifactPath(path) ? "secret artifact output" : "request output",
      allowRepoOutput: Boolean(options["allow-repo-output"]),
      protectRepo: true,
    });
    console.log(JSON.stringify({
      ok: true,
      status: result.response.status,
      output: outputPath,
      redacted: result.json,
      sensitivePackage: isSecretArtifactPath(path) || undefined,
      headers: redactHeaders(result.response.headers),
    }, null, 2));
    return;
  }
  if (!result.json && isTextContent(result.contentType)) {
    console.log(redactSensitiveString(result.body));
    return;
  }
  if (!result.json) {
    fail(`non-text response from ${path} requires --output`);
  }
  console.log(JSON.stringify({
    ok: true,
    status: result.response.status,
    method,
    path,
    workspaceId: workspaceId || undefined,
    idempotencyKey: idempotencyKey || undefined,
    body: redactSensitive(result.body),
  }, null, 2));
}

async function logout(options) {
  const session = await loadSession(options);
  try {
    await sessionRequest(session, "/api/auth/logout", { method: "POST" });
  } catch {
    // Remove local state even if the remote session is already gone.
  }
  await rm(profilePath(options), { force: true });
  console.log(JSON.stringify({ ok: true, profile: profileName(options), loggedOut: true }, null, 2));
}

function requireAdminAgentEnv() {
  if (!ADMIN_AGENT_TOKEN) {
    fail("TOKHUB_ADMIN_AGENT_TOKEN is required for admin-agent commands");
  }
  return { baseUrl: normalizeAdminAgentBaseURL(), token: ADMIN_AGENT_TOKEN };
}

function normalizeAdminAgentPath(path) {
  if (!path || !path.startsWith("/api/admin/")) {
    fail(`admin-agent client only allows /api/admin/* paths, got ${path || "<empty>"}`);
  }
  assertSafeAPIPath(path);
  if (path.startsWith("/api/admin/agent-tokens")) {
    fail("admin-agent bearer tokens cannot manage /api/admin/agent-tokens");
  }
  return path;
}

async function anonymousJSONFetch(baseUrl, path, { method = "GET", body, csrfToken, jar } = {}) {
  const headers = new Headers({ Accept: "application/json" });
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const cookie = cookieHeader(jar);
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  storeCookies(jar, response.headers);
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      fail(`HTTP ${response.status} from ${path}: non-JSON response`);
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.code || text || response.statusText;
    fail(`HTTP ${response.status} from ${path}: ${message}`);
  }
  return payload;
}

async function adminAgentBootstrap(options) {
  const inputs = await promptCredentials(options, "TokHub admin", { admin: true });
  const baseUrl = normalizeBaseURL(inputs.rawURL);
  const tokenName = options["token-name"] || process.env.TOKHUB_ADMIN_AGENT_TOKEN_NAME || "codex-local";
  const scopes = String(options.scopes || process.env.TOKHUB_ADMIN_AGENT_TOKEN_SCOPES || "admin:*")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const ttlHours = parseTTLHours(options["ttl-hours"] || process.env.TOKHUB_ADMIN_AGENT_TOKEN_TTL_HOURS || "24");
  if (!inputs.identifier.trim()) {
    fail("admin username/email is required");
  }
  if (!inputs.password) {
    fail("admin password is required");
  }
  const jar = new Map();
  const csrf = await anonymousJSONFetch(baseUrl, "/api/auth/csrf", { jar });
  if (!csrf.csrfToken) {
    fail("CSRF token was not returned by target TokHub backend");
  }
  await anonymousJSONFetch(baseUrl, "/api/auth/login", {
    method: "POST",
    jar,
    csrfToken: csrf.csrfToken,
    body: JSON.stringify({ identifier: inputs.identifier.trim(), email: inputs.identifier.trim(), password: inputs.password }),
  });
  const created = await anonymousJSONFetch(baseUrl, "/api/admin/agent-tokens", {
    method: "POST",
    jar,
    csrfToken: csrf.csrfToken,
    body: JSON.stringify({ name: tokenName, scopes, ttlHours }),
  });
  const plainToken = created?.token?.plainToken;
  if (!plainToken) {
    fail("admin-agent token response did not include plainToken");
  }
  const envText = `export TOKHUB_BASE_URL=${shellQuote(baseUrl)}\nexport TOKHUB_ADMIN_AGENT_TOKEN=${shellQuote(plainToken)}\n`;
  const envFile = options["save-env"] || options["env-file"] || "";
  if (envFile) {
    const envPath = await writeProtectedFile(envFile, envText, {
      mode: 0o600,
      overwrite: Boolean(options.overwrite),
      label: "admin-agent env file",
      allowRepoOutput: Boolean(options["allow-repo-output"]),
      protectRepo: true,
    });
    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      envFile: envPath,
      tokenMask: created.token.tokenMask,
      scopes: created.token.scopes,
      expiresAt: created.token.expiresAt || null,
      next: `source ${envPath} && node ${process.argv[1]} admin-agent preflight`,
    }, null, 2));
    return;
  }
  console.log("# Paste these exports into your current shell. Treat the token as a secret.");
  process.stdout.write(envText);
}

async function adminAgentFetch(path, init = {}) {
  const env = requireAdminAgentEnv();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.token}`);
  const response = await fetch(`${env.baseUrl}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const body = buffer.toString("utf8");
    fail(`HTTP ${response.status} ${response.statusText} for ${path}: ${body}`);
  }
  if (contentType.includes("application/json")) {
    return { response, body: JSON.parse(buffer.toString("utf8")), raw: buffer, contentType, json: true };
  }
  return { response, body: buffer.toString("utf8"), raw: buffer, contentType, json: false };
}

async function adminAgentPreflight() {
  const env = requireAdminAgentEnv();
  const health = await fetch(`${env.baseUrl}/healthz`);
  if (!health.ok) {
    fail(`healthz failed with HTTP ${health.status}`);
  }
  const admin = await adminAgentFetch("/api/admin/production-health", { method: "GET" });
  console.log(JSON.stringify({
    ok: true,
    baseUrl: env.baseUrl,
    healthz: await health.json(),
    productionHealthKeys: Object.keys(admin.body || {}),
  }, null, 2));
}

async function adminAgentRequest(method, path, options) {
  method = String(method || "").toUpperCase();
  path = normalizeAdminAgentPath(path);
  const guarded = needsExecutionGuard(method, path);
  const reason = options.reason || process.env.TOKHUB_ADMIN_AGENT_REASON || "";
  const idempotencyKey = options["idempotency-key"] || process.env.TOKHUB_ADMIN_AGENT_IDEMPOTENCY_KEY || "";
  if (guarded && !options.execute) {
    console.log(JSON.stringify({
      blocked: true,
      reason: "mutating_or_sensitive_operation_requires_execute",
      method,
      path,
      requiredFlags: ["--execute", "--reason", "--idempotency-key"],
    }, null, 2));
    process.exit(2);
  }
  if (guarded && reason.trim().length < 3) {
    fail("--reason is required for this operation");
  }
  if (guarded && !/^\S{8,120}$/.test(idempotencyKey)) {
    fail("--idempotency-key must be 8-120 non-space characters");
  }
  const headers = new Headers();
  const requestBody = await readRequestBody(options);
  if (requestBody.contentType) {
    headers.set("Content-Type", requestBody.contentType);
  }
  if (reason) {
    headers.set("X-TokHub-Agent-Reason", reason);
  }
  if (idempotencyKey) {
    headers.set("X-Idempotency-Key", idempotencyKey);
  }
  if (!options.output && isArtifactPath(path)) {
    fail(`${pathOnly(path)} returns export or package content and requires --output`);
  }
  const result = await adminAgentFetch(path, { method, headers, body: requestBody.body });
  if (options.output) {
    const output = result.json
      ? Buffer.from(`${JSON.stringify(redactSensitive(result.body), null, 2)}\n`, "utf8")
      : result.raw;
    const outputPath = await writeProtectedFile(options.output, output, {
      mode: 0o600,
      overwrite: Boolean(options.overwrite),
      label: isSecretArtifactPath(path) ? "secret artifact output" : "admin-agent output",
      allowRepoOutput: Boolean(options["allow-repo-output"]),
      protectRepo: true,
    });
    console.log(JSON.stringify({
      ok: true,
      status: result.response.status,
      output: outputPath,
      redacted: result.json,
      sensitivePackage: isSecretArtifactPath(path) || undefined,
      headers: redactHeaders(result.response.headers),
    }, null, 2));
    return;
  }
  if (!result.json && isTextContent(result.contentType)) {
    console.log(redactSensitiveString(result.body));
    return;
  }
  if (!result.json) {
    fail(`non-text response from ${path} requires --output`);
  }
  console.log(JSON.stringify({
    ok: true,
    status: result.response.status,
    method,
    path,
    idempotencyKey: idempotencyKey || undefined,
    body: redactSensitive(result.body),
  }, null, 2));
}

async function adminAgentAuditVerify(options) {
  const tokenID = options["token-id"] || "";
  const idempotencyKey = options["idempotency-key"] || "";
  const limit = options.limit || "500";
  const params = new URLSearchParams({ limit });
  if (tokenID) {
    params.set("actor", tokenID);
  }
  const result = await adminAgentFetch(`/api/admin/audit?${params.toString()}`, { method: "GET" });
  const items = Array.isArray(result.body.items) ? result.body.items : [];
  const matches = items.filter((item) => {
    const metadata = item.metadata || {};
    if (tokenID && item.actorId !== tokenID && metadata.agent_token_id !== tokenID) {
      return false;
    }
    if (idempotencyKey && metadata.idempotency_key !== idempotencyKey) {
      return false;
    }
    return item.actorType === "agent" || metadata.agent_token_id;
  });
  console.log(JSON.stringify({
    ok: matches.length > 0,
    checked: items.length,
    matches: redactSensitive(matches.slice(0, 5)),
  }, null, 2));
  if (matches.length === 0) {
    process.exit(3);
  }
}

async function catalogCheck() {
  const catalogPath = join(SKILL_DIR, "references", "operation-catalog.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const seen = new Set();
  const familyCounts = {};
  for (const op of catalog.operations || []) {
    if (!op.family || !op.method || !op.path || !op.auth || !op.risk) {
      fail(`catalog operation is missing required fields: ${JSON.stringify(op)}`);
    }
    if (!ALLOWED_REQUEST_PREFIXES.some((prefix) => op.path.startsWith(prefix))) {
      fail(`catalog path is outside allowed prefixes: ${op.path}`);
    }
    const key = `${op.method} ${op.path}`;
    if (seen.has(key)) {
      fail(`duplicate catalog operation: ${key}`);
    }
    seen.add(key);
    familyCounts[op.family] = (familyCounts[op.family] || 0) + 1;
  }
  await access(join(SKILL_DIR, "references", "admin-agent-operation-catalog.json"), fsConstants.R_OK);
  console.log(JSON.stringify({
    ok: true,
    version: catalog.version,
    operations: seen.size,
    families: familyCounts,
    adminAgentCatalog: "references/admin-agent-operation-catalog.json",
  }, null, 2));
}

async function redactSelfTest() {
  const gatewayKey = ["sk-th", "self-test-gateway-key"].join("-");
  const adminToken = ["aat", "self-test-admin-agent-token"].join("_");
  const marker = "redaction-sample";
  const sample = {
    apiKey: `${marker}-provider-key`,
    plainKey: gatewayKey,
    plainToken: adminToken,
    nested: { site_key: `${marker}-site-key`, ok: "visible" },
  };
  const redacted = redactSensitive(sample);
  const text = JSON.stringify(redacted);
  if (text.includes(marker) || text.includes(gatewayKey) || text.includes(adminToken)) {
    fail("redaction self-test leaked a secret-looking value");
  }
  console.log(JSON.stringify({ ok: true, redacted }, null, 2));
}

async function adminAgentMain(subcommand, positional, options) {
  if (subcommand === "bootstrap") {
    await adminAgentBootstrap(options);
    return;
  }
  if (subcommand === "preflight") {
    await adminAgentPreflight();
    return;
  }
  if (subcommand === "request") {
    const method = positional[2];
    const path = positional[3];
    if (!method || !path) {
      fail("admin-agent request requires METHOD and /api/admin/path");
    }
    await adminAgentRequest(method, path, options);
    return;
  }
  if (subcommand === "audit-verify") {
    if (!options["token-id"] && !options["idempotency-key"]) {
      options["idempotency-key"] = process.env.TOKHUB_ADMIN_AGENT_IDEMPOTENCY_KEY || "";
    }
    if (!options["token-id"] && !options["idempotency-key"]) {
      fail("admin-agent audit-verify requires --token-id, --idempotency-key, or TOKHUB_ADMIN_AGENT_IDEMPOTENCY_KEY");
    }
    await adminAgentAuditVerify(options);
    return;
  }
  fail(`unknown admin-agent command: ${subcommand || "<empty>"}`);
}

async function main() {
  const { positional, options } = parseOptions(process.argv.slice(2));
  if (options.help || positional.length === 0) {
    usage();
    return;
  }
  const command = positional[0];
  if (command === "login") {
    await login(options);
    return;
  }
  if (command === "whoami") {
    await whoami(options);
    return;
  }
  if (command === "preflight") {
    await preflight(options);
    return;
  }
  if (command === "workspaces") {
    await workspaces(positional[1], positional, options);
    return;
  }
  if (command === "request") {
    await request(positional[1], positional[2], options);
    return;
  }
  if (command === "logout") {
    await logout(options);
    return;
  }
  if (command === "admin-agent") {
    await adminAgentMain(positional[1], positional, options);
    return;
  }
  if (command === "catalog-check") {
    await catalogCheck();
    return;
  }
  if (command === "redact-self-test") {
    await redactSelfTest();
    return;
  }
  fail(`unknown command: ${command}`);
}

main().catch((error) => fail(error?.stack || error?.message || String(error)));
