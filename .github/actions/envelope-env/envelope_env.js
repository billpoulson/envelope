const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatSecretsDotenv(secretsMap) {
  const lines = Object.keys(secretsMap)
    .sort()
    .map((key) => {
      return `${key}=${String(secretsMap[key])}`;
    });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function buildFetchUrl(envelopeUrl, token) {
  const base = envelopeUrl.trim().replace(/\/+$/, "");
  const raw = token.trim();
  if (raw.length < 16 || raw.length > 256) {
    throw new Error("token length must be between 16 and 256 characters");
  }
  return `${base}/env/${encodePathSegment(raw)}?format=json`;
}

function opaqueUrlWithJsonFormat(opaqueUrl) {
  const url = new URL(opaqueUrl.trim());
  url.searchParams.set("format", "json");
  return url.toString();
}

function redactedHost(url) {
  try {
    return new URL(url).hostname || "unknown-host";
  } catch {
    return "unknown-host";
  }
}

function redactedFetchTarget(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/");
    const envIdx = parts.indexOf("env");
    if (envIdx >= 0 && parts.length > envIdx + 1) {
      parts[envIdx + 1] = "<redacted>";
      parsed.pathname = parts.join("/");
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`.replace(
      /%3Credacted%3E/gi,
      "<redacted>",
    );
  } catch {
    return "<invalid-url>";
  }
}

function sanitizeDebugText(value) {
  return String(value || "")
    .replace(/\/env\/[^/?#\s"'`]+/g, "/env/<redacted>")
    .replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>");
}

async function responseDebugDetail(response) {
  if (!response || typeof response.text !== "function") {
    return "";
  }
  let text = "";
  try {
    if (typeof response.clone === "function") {
      text = await response.clone().text();
    } else {
      text = await response.text();
    }
  } catch {
    return "";
  }
  return sanitizeDebugText(text).slice(0, 500);
}

function debugLog(enabled, logImpl, message) {
  if (enabled) {
    logImpl(`[envelope-env debug] ${message}`);
  }
}

function buildUsageHeaders({ usageName = "", usageKind = "", usageRun = "" } = {}) {
  const headers = {};
  const values = [
    ["X-Envelope-Usage-Name", usageName],
    ["X-Envelope-Usage-Kind", usageKind],
    ["X-Envelope-Usage-Run", usageRun],
  ];
  for (const [name, value] of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) {
      headers[name] = trimmed;
    }
  }
  return headers;
}

function parseSecondsInput(value, defaultValue, name) {
  const raw = String(value || "").trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(startedAt, retryTimeoutMs, nowImpl) {
  return retryTimeoutMs > 0 && nowImpl() - startedAt < retryTimeoutMs;
}

async function fetchJson(
  url,
  {
    insecureHttp = false,
    fetchImpl = fetch,
    debug = false,
    logImpl = console.log,
    nowImpl = Date.now,
    retryIntervalMs = 0,
    retryTimeoutMs = 0,
    sleepImpl = sleep,
    usageHeaders = {},
  } = {},
) {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && !insecureHttp) {
    throw new Error("refusing http:// (set insecure-http: true for local dev only)");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid URL scheme (https required)");
  }

  const startedAt = nowImpl();
  let attempt = 0;
  let response;
  debugLog(
    debug,
    logImpl,
    `fetch target ${JSON.stringify(redactedFetchTarget(url))}; retryTimeoutMs=${retryTimeoutMs}; retryIntervalMs=${retryIntervalMs}`,
  );
  while (true) {
    attempt += 1;
    debugLog(debug, logImpl, `attempt ${attempt} started`);
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", ...usageHeaders },
        method: "GET",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      debugLog(debug, logImpl, `attempt ${attempt} failed with network error`);
      if (!shouldRetry(startedAt, retryTimeoutMs, nowImpl)) {
        throw new Error(`request failed for host ${JSON.stringify(redactedHost(url))}: network error`);
      }
      console.warn(
        `request not ready for host ${JSON.stringify(redactedHost(url))}: network error; retrying attempt ${attempt + 1}`,
      );
      await sleepImpl(retryIntervalMs);
      continue;
    }

    if (response.ok) {
      debugLog(debug, logImpl, `attempt ${attempt} succeeded with HTTP ${response.status}`);
      break;
    }

    const detail = debug ? await responseDebugDetail(response) : "";
    debugLog(
      debug,
      logImpl,
      `attempt ${attempt} received HTTP ${response.status}${detail ? `; response=${JSON.stringify(detail)}` : ""}`,
    );
    if (!shouldRetry(startedAt, retryTimeoutMs, nowImpl)) {
      throw new Error(
        `request failed for host ${JSON.stringify(redactedHost(url))} (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    console.warn(
      `request not ready for host ${JSON.stringify(redactedHost(url))} (HTTP ${response.status}); retrying attempt ${attempt + 1}`,
    );
    await sleepImpl(retryIntervalMs);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("invalid JSON in response", { cause: error });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("expected JSON object in response");
  }

  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      out[key] = "";
    } else if (typeof value === "string") {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function sortedJson(secretsMap) {
  const out = {};
  for (const key of Object.keys(secretsMap).sort()) {
    out[key] = secretsMap[key];
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(path.resolve(filePath)) || ".";
  const tempPath = path.join(dir, `.env-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failures after a failed write/rename.
      }
    }
  }
}

const GITHUB_ENV_NAME_RE = /^[A-Za-z0-9_]+$/;

function appendGithubEnv(secretsMap, githubEnvPath) {
  let body = "";
  for (const key of Object.keys(secretsMap).sort()) {
    if (!key || !GITHUB_ENV_NAME_RE.test(key)) {
      throw new Error(`invalid environment variable name for GITHUB_ENV: ${JSON.stringify(key)}`);
    }
    const value = secretsMap[key];
    let delimiter = `EOF_ENVELOPE_${crypto.randomBytes(16).toString("hex")}`;
    while (value.includes(delimiter)) {
      delimiter = `EOF_ENVELOPE_${crypto.randomBytes(16).toString("hex")}`;
    }
    body += `${key}<<${delimiter}\n`;
    body += value;
    if (!value.endsWith("\n")) {
      body += "\n";
    }
    body += `${delimiter}\n`;
  }
  fs.appendFileSync(githubEnvPath, body, "utf8");
}

function appendGithubOutput(name, value, githubOutputPath) {
  fs.appendFileSync(githubOutputPath, `${name}=${value}\n`, "utf8");
}

function getInput(name) {
  const githubEnvName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const fallbackEnvName = `INPUT_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return (process.env[githubEnvName] || process.env[fallbackEnvName] || "").trim();
}

function isTruthyInput(value) {
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

function defaultOutFile() {
  const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
  return path.join(runnerTemp, "envelope.env");
}

async function main() {
  const opaqueEnvUrl = getInput("opaque-env-url");
  const envelopeUrl = getInput("envelope-url");
  const token = getInput("token");
  const outFile = getInput("out-file") || defaultOutFile();
  const outFormat = getInput("out-format") || "dotenv";
  const exportToGithubEnv = isTruthyInput(getInput("export-to-github-env"));
  const insecureHttp = isTruthyInput(getInput("insecure-http"));
  const debug = isTruthyInput(getInput("debug"));
  const usageHeaders = buildUsageHeaders({
    usageKind: getInput("usage-kind"),
    usageName: getInput("usage-name"),
    usageRun: getInput("usage-run"),
  });
  const retryTimeoutSeconds = parseSecondsInput(getInput("retry-timeout-seconds"), 120, "retry-timeout-seconds");
  const retryIntervalSeconds = parseSecondsInput(getInput("retry-interval-seconds"), 5, "retry-interval-seconds");

  if (outFormat !== "dotenv" && outFormat !== "json") {
    throw new Error("out-format must be either 'dotenv' or 'json'");
  }

  let fetchUrl;
  if (opaqueEnvUrl) {
    fetchUrl = opaqueUrlWithJsonFormat(opaqueEnvUrl);
  } else if (envelopeUrl && token) {
    fetchUrl = buildFetchUrl(envelopeUrl, token);
  } else {
    throw new Error("provide opaque-env-url, or both envelope-url and token");
  }

  const secretsMap = await fetchJson(fetchUrl, {
    debug,
    insecureHttp,
    retryIntervalMs: retryIntervalSeconds * 1000,
    retryTimeoutMs: retryTimeoutSeconds * 1000,
    usageHeaders,
  });
  if (outFormat === "json") {
    atomicWrite(outFile, sortedJson(secretsMap));
  } else {
    atomicWrite(outFile, formatSecretsDotenv(secretsMap));
  }

  if (process.env.GITHUB_OUTPUT) {
    appendGithubOutput("out-file", path.resolve(outFile), process.env.GITHUB_OUTPUT);
  }

  if (exportToGithubEnv) {
    if (!process.env.GITHUB_ENV) {
      throw new Error("export-to-github-env requires GITHUB_ENV (GitHub Actions)");
    }
    appendGithubEnv(secretsMap, process.env.GITHUB_ENV);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  appendGithubEnv,
  atomicWrite,
  buildUsageHeaders,
  buildFetchUrl,
  defaultOutFile,
  fetchJson,
  formatSecretsDotenv,
  getInput,
  opaqueUrlWithJsonFormat,
  parseSecondsInput,
  redactedFetchTarget,
  sanitizeDebugText,
  sortedJson,
};
