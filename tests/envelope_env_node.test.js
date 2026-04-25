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

test("formatSecretsDotenv sorts keys and escapes dotenv values", () => {
  assert.equal(
    action.formatSecretsDotenv({ B: "a\nb", A: 'q"uote', C: "back\\slash" }),
    'A="q\\"uote"\nB="a\\nb"\nC="back\\\\slash"\n',
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
