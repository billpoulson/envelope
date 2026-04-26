const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ENV_KEY_RE = /^[A-Za-z0-9_]+$/;

function getInput(name) {
  const githubEnvName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const fallbackEnvName = `INPUT_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return (process.env[githubEnvName] || process.env[fallbackEnvName] || "").trim();
}

function isTruthyInput(value) {
  return ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
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

function requireInput(name) {
  const value = getInput(name);
  if (!value) {
    throw new Error(`missing required input: ${name}`);
  }
  return value;
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function redactedHost(url) {
  try {
    return new URL(url).hostname || "unknown-host";
  } catch {
    return "unknown-host";
  }
}

function buildApiUrl(envelopeUrl, apiPath, query = {}) {
  const base = envelopeUrl.trim().replace(/\/+$/, "");
  const url = new URL(`${base}${apiPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function assertAllowedUrl(url, insecureHttp = false) {
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && !insecureHttp) {
    throw new Error("refusing http:// (set insecure-http: true for local dev only)");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid URL scheme (https required)");
  }
}

function parseOutputs(raw) {
  const out = [];
  const seen = new Set();
  for (const part of String(raw || "").split(",")) {
    const key = part.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function hasGlobMagic(pattern) {
  return /[*?]/.test(pattern);
}

function globPatternToRegExp(pattern) {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source);
}

function resolveOutputKeys(pulumiOutputs, outputPatterns) {
  const available = Object.keys(pulumiOutputs).sort();
  const selected = [];
  const seen = new Set();
  const missing = [];

  for (const pattern of outputPatterns) {
    const matches = hasGlobMagic(pattern)
      ? available.filter((key) => globPatternToRegExp(pattern).test(key))
      : available.filter((key) => key === pattern);
    if (matches.length === 0) {
      missing.push(pattern);
      continue;
    }
    for (const key of matches) {
      if (!seen.has(key)) {
        seen.add(key);
        selected.push(key);
      }
    }
  }

  return { missing, selected };
}

function parseMap(raw) {
  const mappings = [];
  for (const [idx, line] of String(raw || "").split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const sep = trimmed.indexOf("=");
    if (sep <= 0 || sep === trimmed.length - 1) {
      throw new Error(`invalid map line ${idx + 1}: expected ENV_KEY=pulumiOutputName`);
    }
    const envKey = trimmed.slice(0, sep).trim();
    const pulumiKey = trimmed.slice(sep + 1).trim();
    if (!ENV_KEY_RE.test(envKey)) {
      throw new Error(`invalid mapped Envelope key: ${JSON.stringify(envKey)}`);
    }
    if (!pulumiKey) {
      throw new Error(`invalid map line ${idx + 1}: Pulumi output name is required`);
    }
    mappings.push({ envKey, pulumiKey });
  }
  return mappings;
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableNormalize(value[key]);
    }
    return out;
  }
  return value;
}

function coercePulumiValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(stableNormalize(value));
}

function parsePulumiJson(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error("invalid Pulumi JSON", { cause: error });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Pulumi JSON must be an object");
  }
  return data;
}

function runPulumiStackOutput({ stack = "", cwd = "", spawnImpl = spawnSync } = {}) {
  const args = ["stack", "output", "--json"];
  if (stack) {
    args.push("--stack", stack);
  }
  const result = spawnImpl("pulumi", args, {
    cwd: cwd ? path.resolve(cwd) : undefined,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`failed to run pulumi: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pulumi stack output failed with exit code ${result.status}`);
  }
  return result.stdout || "";
}

function loadPulumiOutputs(options, deps = {}) {
  const rawJson = (options.pulumiJson || "").trim();
  const jsonFile = (options.pulumiJsonFile || "").trim();
  if (rawJson) {
    return parsePulumiJson(rawJson);
  }
  if (jsonFile) {
    return parsePulumiJson(fs.readFileSync(jsonFile, "utf8"));
  }
  if (options.runPulumi) {
    return parsePulumiJson(
      runPulumiStackOutput({
        stack: options.pulumiStack || "",
        cwd: options.pulumiCwd || "",
        spawnImpl: deps.spawnImpl || spawnSync,
      }),
    );
  }
  throw new Error("provide pulumi-json, pulumi-json-file, or run-pulumi: true");
}

function buildEnvelopeEntries(pulumiOutputs, outputsRaw, mapRaw) {
  const outputs = parseOutputs(outputsRaw);
  const mappings = parseMap(mapRaw);
  if (outputs.length === 0 && mappings.length === 0) {
    throw new Error("provide outputs and/or map");
  }

  const entries = {};
  const missing = [];
  const mappedSources = new Set();

  for (const { envKey, pulumiKey } of mappings) {
    mappedSources.add(pulumiKey);
    if (!Object.prototype.hasOwnProperty.call(pulumiOutputs, pulumiKey)) {
      missing.push(pulumiKey);
      continue;
    }
    entries[envKey] = { value: coercePulumiValue(pulumiOutputs[pulumiKey]), secret: true };
  }

  const resolvedOutputs = resolveOutputKeys(pulumiOutputs, outputs);
  missing.push(...resolvedOutputs.missing);

  for (const pulumiKey of resolvedOutputs.selected) {
    if (mappedSources.has(pulumiKey)) {
      continue;
    }
    if (!ENV_KEY_RE.test(pulumiKey)) {
      throw new Error(`Pulumi output ${JSON.stringify(pulumiKey)} needs a valid map target`);
    }
    entries[pulumiKey] = { value: coercePulumiValue(pulumiOutputs[pulumiKey]), secret: true };
  }

  if (missing.length) {
    const unique = [...new Set(missing)].sort();
    throw new Error(`Pulumi output(s) not found: ${unique.join(", ")}`);
  }
  if (Object.keys(entries).length === 0) {
    throw new Error("no Envelope entries selected from Pulumi outputs");
  }
  return entries;
}

async function requestJson(url, { apiKey, method, body, insecureHttp = false, fetchImpl = fetch, usageHeaders = {} }) {
  assertAllowedUrl(url, insecureHttp);
  let response;
  try {
    response = await fetchImpl(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...usageHeaders,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      method,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(`Envelope API request failed for host ${JSON.stringify(redactedHost(url))}: network error`);
  }

  if (!response.ok) {
    return { ok: false, status: response.status, data: null };
  }
  if (response.status === 204) {
    return { ok: true, status: response.status, data: null };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: true, status: response.status, data };
}

async function pushEntries(options, deps = {}) {
  const {
    envelopeUrl,
    apiKey,
    projectSlug,
    environmentSlug,
    bundleSlug,
    entries,
    insecureHttp = false,
    usageHeaders = {},
  } = options;
  const fetchImpl = deps.fetchImpl || fetch;
  const bundlePath = `/api/v1/bundles/${encodePathSegment(bundleSlug)}`;
  const scope = { project_slug: projectSlug, environment_slug: environmentSlug };
  const patchUrl = buildApiUrl(envelopeUrl, bundlePath, scope);
  const patch = await requestJson(patchUrl, {
    apiKey,
    body: { entries },
    fetchImpl,
    insecureHttp,
    method: "PATCH",
    usageHeaders,
  });
  if (patch.ok) {
    return { created: false, updatedCount: Object.keys(entries).length, data: patch.data };
  }
  if (patch.status !== 404) {
    throw new Error(
      `Envelope API request failed for host ${JSON.stringify(redactedHost(patchUrl))} (HTTP ${patch.status})`,
    );
  }

  const createUrl = buildApiUrl(envelopeUrl, "/api/v1/bundles");
  const create = await requestJson(createUrl, {
    apiKey,
    body: {
      entries,
      name: bundleSlug,
      project_environment_slug: environmentSlug,
      project_slug: projectSlug,
      slug: bundleSlug,
    },
    fetchImpl,
    insecureHttp,
    method: "POST",
    usageHeaders,
  });
  if (!create.ok) {
    throw new Error(
      `Envelope API request failed for host ${JSON.stringify(redactedHost(createUrl))} (HTTP ${create.status})`,
    );
  }
  return { created: true, updatedCount: Object.keys(entries).length, data: create.data };
}

function appendGithubOutput(name, value, githubOutputPath) {
  fs.appendFileSync(githubOutputPath, `${name}=${value}\n`, "utf8");
}

async function main() {
  const envelopeUrl = requireInput("envelope-url");
  const apiKey = requireInput("api-key");
  const projectSlug = requireInput("project-slug");
  const environmentSlug = requireInput("environment-slug");
  const bundleSlug = requireInput("bundle-slug");
  const insecureHttp = isTruthyInput(getInput("insecure-http"));
  const usageHeaders = buildUsageHeaders({
    usageKind: getInput("usage-kind"),
    usageName: getInput("usage-name"),
    usageRun: getInput("usage-run"),
  });
  const pulumiOutputs = loadPulumiOutputs({
    pulumiCwd: getInput("pulumi-cwd"),
    pulumiJson: getInput("pulumi-json"),
    pulumiJsonFile: getInput("pulumi-json-file"),
    pulumiStack: getInput("pulumi-stack"),
    runPulumi: isTruthyInput(getInput("run-pulumi")),
  });
  const entries = buildEnvelopeEntries(pulumiOutputs, getInput("outputs"), getInput("map"));
  const result = await pushEntries({
    apiKey,
    bundleSlug,
    entries,
    envelopeUrl,
    environmentSlug,
    insecureHttp,
    projectSlug,
    usageHeaders,
  });

  if (process.env.GITHUB_OUTPUT) {
    appendGithubOutput("bundle-slug", bundleSlug, process.env.GITHUB_OUTPUT);
    appendGithubOutput("updated-count", String(result.updatedCount), process.env.GITHUB_OUTPUT);
    appendGithubOutput("created", result.created ? "true" : "false", process.env.GITHUB_OUTPUT);
  }

  const action = result.created ? "Created" : "Updated";
  console.log(`${action} Envelope bundle ${JSON.stringify(bundleSlug)} with ${result.updatedCount} entrie(s).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildApiUrl,
  buildEnvelopeEntries,
  buildUsageHeaders,
  coercePulumiValue,
  getInput,
  loadPulumiOutputs,
  parseMap,
  parseOutputs,
  parsePulumiJson,
  resolveOutputKeys,
  pushEntries,
  requestJson,
  runPulumiStackOutput,
};
