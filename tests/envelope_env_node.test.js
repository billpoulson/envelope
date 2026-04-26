const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const action = require("../.github/actions/envelope-env/envelope_env.js");

test("buildFetchUrl handles root and path-prefixed deployments", () => {
  assert.equal(
    action.buildFetchUrl("https://envelope.example.com", "a".repeat(16)),
    `https://envelope.example.com/env/${"a".repeat(16)}?format=json`,
  );
  assert.equal(
    action.buildFetchUrl("https://envelope.example.com/envelope/", "b".repeat(16)),
    `https://envelope.example.com/envelope/env/${"b".repeat(16)}?format=json`,
  );
});

test("buildFetchUrl validates token length and encodes token path segment", () => {
  assert.throws(
    () => action.buildFetchUrl("https://x.example", "x".repeat(15)),
    /token length must be between 16 and 256 characters/,
  );
  assert.equal(
    action.buildFetchUrl("https://x.example", `${"a".repeat(16)}/!*`),
    `https://x.example/env/${"a".repeat(16)}%2F%21%2A?format=json`,
  );
});

test("opaqueUrlWithJsonFormat forces json and preserves other query params", () => {
  assert.equal(
    action.opaqueUrlWithJsonFormat(`https://h.example/env/${"c".repeat(16)}?format=dotenv&x=1`),
    `https://h.example/env/${"c".repeat(16)}?format=json&x=1`,
  );
  assert.equal(
    action.opaqueUrlWithJsonFormat(`https://h.example/env/${"d".repeat(16)}?x=1`),
    `https://h.example/env/${"d".repeat(16)}?x=1&format=json`,
  );
});

test("formatSecretsDotenv sorts keys and writes raw persisted values", () => {
  assert.equal(
    action.formatSecretsDotenv({
      B: "plain",
      A: "['https://exhelion.net/auth/callback']",
      C: "'http://localhost/auth/callback'",
    }),
    "A=['https://exhelion.net/auth/callback']\nB=plain\nC='http://localhost/auth/callback'\n",
  );
});

test("sortedJson sorts keys and writes trailing newline", () => {
  assert.equal(action.sortedJson({ B: "2", A: "1" }), '{\n  "A": "1",\n  "B": "2"\n}\n');
});

test("appendGithubEnv writes multiline-safe values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-node-test-"));
  const envPath = path.join(dir, "github-env");
  try {
    action.appendGithubEnv({ K: "a\nb" }, envPath);
    const body = fs.readFileSync(envPath, "utf8");
    assert.match(body, /^K<<EOF_ENVELOPE_[a-f0-9]{32}\na\nb\nEOF_ENVELOPE_[a-f0-9]{32}\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("appendGithubEnv rejects invalid variable names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-node-test-"));
  const envPath = path.join(dir, "github-env");
  try {
    assert.throws(() => action.appendGithubEnv({ "BAD-NAME": "x" }, envPath), /invalid environment variable name/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fetchJson normalizes response values and rejects plain http by default", async () => {
  await assert.rejects(
    () => action.fetchJson("http://h.example/env/token?format=json", { fetchImpl: async () => ({}) }),
    /refusing http:\/\//,
  );

  const out = await action.fetchJson("http://h.example/env/token?format=json", {
    insecureHttp: true,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ A: "x", B: null, C: 3, D: false }),
    }),
  });
  assert.deepEqual(out, { A: "x", B: "", C: "3", D: "false" });
});

test("fetchJson retries HTTP failures until the endpoint is ready", async () => {
  const statuses = [400, 502, 200];
  const sleeps = [];
  const out = await action.fetchJson("https://h.example/env/token?format=json", {
    fetchImpl: async () => {
      const status = statuses.shift();
      return {
        ok: status === 200,
        status,
        json: async () => ({ A: "x" }),
      };
    },
    retryIntervalMs: 25,
    retryTimeoutMs: 1_000,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(out, { A: "x" });
  assert.deepEqual(sleeps, [25, 25]);
});

test("fetchJson sends usage headers when provided", async () => {
  const calls = [];
  const out = await action.fetchJson("https://h.example/env/token?format=json", {
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return {
        ok: true,
        status: 200,
        json: async () => ({ A: "x" }),
      };
    },
    usageHeaders: action.buildUsageHeaders({
      usageKind: "github-action",
      usageName: "ci-env-fetch",
      usageRun: "run-123",
    }),
  });

  assert.deepEqual(out, { A: "x" });
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Name"], "ci-env-fetch");
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Kind"], "github-action");
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Run"], "run-123");
});

test("buildUsageHeaders omits blank usage values", () => {
  assert.deepEqual(
    action.buildUsageHeaders({
      usageKind: " ",
      usageName: "ci-env-fetch",
      usageRun: "",
    }),
    { "X-Envelope-Usage-Name": "ci-env-fetch" },
  );
});

test("fetchJson retries network errors before returning JSON", async () => {
  let attempts = 0;
  const out = await action.fetchJson("https://h.example/env/token?format=json", {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary network failure");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ A: "x" }),
      };
    },
    retryIntervalMs: 0,
    retryTimeoutMs: 1_000,
    sleepImpl: async () => {},
  });

  assert.equal(attempts, 2);
  assert.deepEqual(out, { A: "x" });
});

test("fetchJson debug logs redact opaque env tokens and include response details", async () => {
  const logs = [];
  await assert.rejects(
    () =>
      action.fetchJson(`https://h.example/env/${"a".repeat(40)}?format=json`, {
        debug: true,
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          text: async () => `bad token /env/${"b".repeat(40)} rejected`,
        }),
        logImpl: (line) => logs.push(line),
      }),
    (error) => {
      assert.match(error.message, /HTTP 400/);
      assert.match(error.message, /bad token \/env\/<redacted> rejected/);
      assert.doesNotMatch(error.message, /bbbb/);
      return true;
    },
  );

  assert.match(logs.join("\n"), /\/env\/<redacted>\?format=json/);
  assert.match(logs.join("\n"), /response="bad token \/env\/<redacted> rejected"/);
  assert.doesNotMatch(logs.join("\n"), /aaaa/);
  assert.doesNotMatch(logs.join("\n"), /bbbb/);
});

test("redactedFetchTarget preserves host and query while hiding opaque token", () => {
  assert.equal(
    action.redactedFetchTarget(`https://h.example/root/env/${"a".repeat(40)}?format=json&x=1`),
    "https://h.example/root/env/<redacted>?format=json&x=1",
  );
});

test("parseSecondsInput validates non-negative numeric inputs", () => {
  assert.equal(action.parseSecondsInput("", 120, "retry-timeout-seconds"), 120);
  assert.equal(action.parseSecondsInput("2.5", 120, "retry-timeout-seconds"), 2.5);
  assert.throws(
    () => action.parseSecondsInput("-1", 120, "retry-timeout-seconds"),
    /retry-timeout-seconds must be a non-negative number/,
  );
});

test("getInput reads GitHub's hyphenated input environment names", () => {
  const githubName = "INPUT_OPAQUE-ENV-URL";
  const fallbackName = "INPUT_OPAQUE_ENV_URL";
  const oldGithub = process.env[githubName];
  const oldFallback = process.env[fallbackName];
  try {
    delete process.env[fallbackName];
    process.env[githubName] = " https://envelope.example/env/token ";
    assert.equal(action.getInput("opaque-env-url"), "https://envelope.example/env/token");

    delete process.env[githubName];
    process.env[fallbackName] = "fallback";
    assert.equal(action.getInput("opaque-env-url"), "fallback");
  } finally {
    if (oldGithub === undefined) {
      delete process.env[githubName];
    } else {
      process.env[githubName] = oldGithub;
    }
    if (oldFallback === undefined) {
      delete process.env[fallbackName];
    } else {
      process.env[fallbackName] = oldFallback;
    }
  }
});
