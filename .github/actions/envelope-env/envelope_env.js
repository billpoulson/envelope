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

async function fetchJson(url, { insecureHttp = false, fetchImpl = fetch } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && !insecureHttp) {
    throw new Error("refusing http:// (set insecure-http: true for local dev only)");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid URL scheme (https required)");
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(`request failed for host ${JSON.stringify(redactedHost(url))}: network error`);
  }

  if (!response.ok) {
    throw new Error(`request failed for host ${JSON.stringify(redactedHost(url))} (HTTP ${response.status})`);
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

  const secretsMap = await fetchJson(fetchUrl, { insecureHttp });
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
  buildFetchUrl,
  defaultOutFile,
  fetchJson,
  formatSecretsDotenv,
  getInput,
  opaqueUrlWithJsonFormat,
  sortedJson,
};
