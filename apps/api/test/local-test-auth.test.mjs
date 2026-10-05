import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalTestAuthCredentials } from "../dist/local-test-auth.js";

test("keeps the local test account endpoint disabled by default", () => {
  assert.equal(
    resolveLocalTestAuthCredentials(
      {},
      "127.0.0.1",
      "http://127.0.0.1:4176",
    ),
    null,
  );
});

test("requires both private local credentials even when explicitly enabled", () => {
  for (const partial of [{}, { LOCAL_TEST_ACCOUNT_EMAIL: "qa@example.invalid" },
    { LOCAL_TEST_ACCOUNT_PASSWORD: "synthetic-only-password" },
    { LOCAL_TEST_ACCOUNT_EMAIL: "qa@example.invalid", LOCAL_TEST_ACCOUNT_PASSWORD: "   " }]) {
    assert.equal(resolveLocalTestAuthCredentials({ LOCAL_TEST_AUTH_ENABLED: "true", ...partial },
      "127.0.0.1", "http://localhost:4176"), null);
  }
});

test("accepts explicit local credentials without exposing a remote listener", () => {
  const processEnv = {
    LOCAL_TEST_AUTH_ENABLED: "true",
    LOCAL_TEST_ACCOUNT_EMAIL: "qa@sitrail.local",
    LOCAL_TEST_ACCOUNT_PASSWORD: "local-only-password",
  };

  assert.deepEqual(
    resolveLocalTestAuthCredentials(
      processEnv,
      "localhost",
      "http://127.0.0.1:4176",
    ),
    {
      email: "qa@sitrail.local",
      password: "local-only-password",
    },
  );
  assert.equal(
    resolveLocalTestAuthCredentials(
      processEnv,
      "0.0.0.0",
      "http://127.0.0.1:4176",
    ),
    null,
  );
  assert.equal(
    resolveLocalTestAuthCredentials(
      processEnv,
      "127.0.0.1",
      "https://trail.example",
    ),
    null,
  );
});
