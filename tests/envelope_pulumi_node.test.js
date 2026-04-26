const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const action = require("../.github/actions/envelope-pulumi/envelope_pulumi.js");

test("buildEnvelopeEntries maps selected Pulumi outputs and coerces values", () => {
  const entries = action.buildEnvelopeEntries(
    {
      ignoredOutput: "skip-me",
      keycloakServerAdminClientIdOutput: "yacht-server-admin",
      keycloakServerAdminClientSecretOutput: "[secret]",
      nestedOutput: { z: 1, a: true },
      numberOutput: 42,
    },
    "keycloakServerAdminClientIdOutput,numberOutput,nestedOutput",
    "KEYCLOAK_SERVER_ADMIN_CLIENT_SECRET=keycloakServerAdminClientSecretOutput",
  );

  assert.deepEqual(entries, {
    KEYCLOAK_SERVER_ADMIN_CLIENT_SECRET: { value: "[secret]", secret: true },
    keycloakServerAdminClientIdOutput: { value: "yacht-server-admin", secret: true },
    nestedOutput: { value: '{"a":true,"z":1}', secret: true },
    numberOutput: { value: "42", secret: true },
  });
});

test("buildEnvelopeEntries does not duplicate outputs that are also mapped", () => {
  const entries = action.buildEnvelopeEntries(
    { sourceOutput: "value" },
    "sourceOutput",
    "TARGET_ENV_KEY=sourceOutput",
  );
  assert.deepEqual(entries, {
    TARGET_ENV_KEY: { value: "value", secret: true },
  });
});

test("buildEnvelopeEntries expands output globs deterministically", () => {
  const entries = action.buildEnvelopeEntries(
    {
      appPostgresPasswordOutput: "app-pg",
      ignoredValue: "skip-me",
      keycloakPgPasswordOutput: "keycloak-pg",
      keycloakServerAdminClientIdOutput: "yacht-server-admin",
      keycloakServerAdminClientSecretOutput: "[secret]",
    },
    "keycloak*Output,*PostgresPasswordOutput",
    "",
  );

  assert.deepEqual(entries, {
    appPostgresPasswordOutput: { value: "app-pg", secret: true },
    keycloakPgPasswordOutput: { value: "keycloak-pg", secret: true },
    keycloakServerAdminClientIdOutput: { value: "yacht-server-admin", secret: true },
    keycloakServerAdminClientSecretOutput: { value: "[secret]", secret: true },
  });
});

test("buildEnvelopeEntries reports unmatched output glob patterns", () => {
  assert.throws(
    () => action.buildEnvelopeEntries({ keycloakServerAdminClientIdOutput: "x" }, "missing*Output", ""),
    /Pulumi output\(s\) not found: missing\*Output/,
  );
});

test("buildEnvelopeEntries requires map target when a glob selects non-env output names", () => {
  assert.throws(
    () => action.buildEnvelopeEntries({ "bad-output": "x" }, "bad-*", ""),
    /needs a valid map target/,
  );
});

test("buildEnvelopeEntries reports missing Pulumi output names", () => {
  assert.throws(
    () => action.buildEnvelopeEntries({ A: "x" }, "A,B", "C=missingMapped"),
    /Pulumi output\(s\) not found: B, missingMapped/,
  );
});

test("buildEnvelopeEntries requires mapped target for invalid env-style output names", () => {
  assert.throws(
    () => action.buildEnvelopeEntries({ "bad-output": "x" }, "bad-output", ""),
    /needs a valid map target/,
  );
});

test("loadPulumiOutputs prefers raw JSON over file and pulumi execution", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "envelope-pulumi-test-"));
  const filePath = path.join(dir, "pulumi.json");
  try {
    fs.writeFileSync(filePath, '{"FROM_FILE":"file"}', "utf8");
    const data = action.loadPulumiOutputs(
      {
        pulumiJson: '{"FROM_RAW":"raw"}',
        pulumiJsonFile: filePath,
        runPulumi: true,
      },
      {
        spawnImpl: () => {
          throw new Error("should not run pulumi");
        },
      },
    );
    assert.deepEqual(data, { FROM_RAW: "raw" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runPulumiStackOutput invokes pulumi stack output json with optional stack and cwd", () => {
  const calls = [];
  const stdout = action.runPulumiStackOutput({
    cwd: "infra",
    stack: "dev",
    spawnImpl: (cmd, args, options) => {
      calls.push({ args, cmd, cwd: options.cwd });
      return { status: 0, stdout: '{"A":"x"}' };
    },
  });

  assert.equal(stdout, '{"A":"x"}');
  assert.equal(calls[0].cmd, "pulumi");
  assert.deepEqual(calls[0].args, ["stack", "output", "--json", "--stack", "dev"]);
  assert.equal(calls[0].cwd, path.resolve("infra"));
});

test("pushEntries patches existing bundle with scoped query parameters", async () => {
  const calls = [];
  const result = await action.pushEntries(
    {
      apiKey: "env_secret",
      bundleSlug: "keycloak",
      entries: { A: { value: "x", secret: true } },
      envelopeUrl: "https://envelope.example.com/root",
      environmentSlug: "local-dev",
      projectSlug: "my-project",
      usageHeaders: action.buildUsageHeaders({
        usageKind: "github-action",
        usageName: "pulumi-output-push",
        usageRun: "run-123",
      }),
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        return { ok: true, status: 200, json: async () => ({ slug: "keycloak" }) };
      },
    },
  );

  assert.deepEqual(result, { created: false, updatedCount: 1, data: { slug: "keycloak" } });
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /^https:\/\/envelope\.example\.com\/root\/api\/v1\/bundles\/keycloak\?/,
  );
  assert.match(calls[0].url, /project_slug=my-project/);
  assert.match(calls[0].url, /environment_slug=local-dev/);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers.Authorization, "Bearer env_secret");
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Name"], "pulumi-output-push");
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Kind"], "github-action");
  assert.equal(calls[0].options.headers["X-Envelope-Usage-Run"], "run-123");
  assert.equal(calls[0].options.body, JSON.stringify({ entries: { A: { value: "x", secret: true } } }));
});

test("buildUsageHeaders omits blank usage values", () => {
  assert.deepEqual(
    action.buildUsageHeaders({
      usageKind: "ci",
      usageName: "",
      usageRun: " ",
    }),
    { "X-Envelope-Usage-Kind": "ci" },
  );
});

test("pushEntries creates bundle when scoped patch returns 404", async () => {
  const calls = [];
  const result = await action.pushEntries(
    {
      apiKey: "env_secret",
      bundleSlug: "keycloak",
      entries: { A: { value: "x", secret: true } },
      envelopeUrl: "https://envelope.example.com",
      environmentSlug: "local-dev",
      projectSlug: "my-project",
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        if (calls.length === 1) {
          return { ok: false, status: 404 };
        }
        return { ok: true, status: 201, json: async () => ({ slug: "keycloak" }) };
      },
    },
  );

  assert.deepEqual(result, { created: true, updatedCount: 1, data: { slug: "keycloak" } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://envelope.example.com/api/v1/bundles");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    entries: { A: { value: "x", secret: true } },
    name: "keycloak",
    project_environment_slug: "local-dev",
    project_slug: "my-project",
    slug: "keycloak",
  });
});

test("pushEntries rejects plain http by default and permits local insecure mode", async () => {
  await assert.rejects(
    () =>
      action.pushEntries(
        {
          apiKey: "env_secret",
          bundleSlug: "keycloak",
          entries: { A: { value: "x", secret: true } },
          envelopeUrl: "http://127.0.0.1:8080",
          environmentSlug: "local-dev",
          projectSlug: "my-project",
        },
        { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
      ),
    /refusing http:\/\//,
  );

  const result = await action.pushEntries(
    {
      apiKey: "env_secret",
      bundleSlug: "keycloak",
      entries: { A: { value: "x", secret: true } },
      envelopeUrl: "http://127.0.0.1:8080",
      environmentSlug: "local-dev",
      insecureHttp: true,
      projectSlug: "my-project",
    },
    { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
  );
  assert.equal(result.created, false);
});

test("pushEntries redacts API key and request body from HTTP errors", async () => {
  await assert.rejects(
    () =>
      action.pushEntries(
        {
          apiKey: "env_secret_should_not_appear",
          bundleSlug: "keycloak",
          entries: { SECRET_VALUE: { value: "do-not-log", secret: true } },
          envelopeUrl: "https://envelope.example.com",
          environmentSlug: "local-dev",
          projectSlug: "my-project",
        },
        { fetchImpl: async () => ({ ok: false, status: 500 }) },
      ),
    (error) => {
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(error.message, /env_secret_should_not_appear/);
      assert.doesNotMatch(error.message, /do-not-log/);
      return true;
    },
  );
});
