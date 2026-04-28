import { describe, expect, it } from "vitest";

import { loadControlPlaneApiFromEnv } from "./load-env.js";

describe("control-plane api object store config", () => {
  it("loads object-store config from env when fully configured", () => {
    const loaded = loadControlPlaneApiFromEnv({
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_BUCKET_NAME: "mistle-assets",
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_REGION: "us-east-1",
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ENDPOINT: "http://127.0.0.1:8333",
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_FORCE_PATH_STYLE: "true",
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_ACCESS_KEY_ID: "mistle-access-key",
      MISTLE_APPS_CONTROL_PLANE_API_OBJECT_STORE_SECRET_ACCESS_KEY: "mistle-secret-key",
    });

    expect(loaded.objectStore).toEqual({
      bucketName: "mistle-assets",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:8333",
      forcePathStyle: true,
      accessKeyId: "mistle-access-key",
      secretAccessKey: "mistle-secret-key",
    });
  });
});

describe("control-plane api workflow config", () => {
  it("loads workflow migration config from env when configured", () => {
    const loaded = loadControlPlaneApiFromEnv({
      MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL:
        "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
      MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_MIGRATION_URL:
        "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: "development",
    });

    expect(loaded.workflow).toEqual({
      databaseUrl: "postgresql://mistle:mistle@127.0.0.1:6432/mistle",
      migrationUrl: "postgresql://mistle:mistle@127.0.0.1:5432/mistle",
      namespaceId: "development",
    });
  });
});

describe("control-plane api auth google config", () => {
  it("loads auth config without google when google env vars are absent", () => {
    const loaded = loadControlPlaneApiFromEnv({
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: "http://127.0.0.1:5000",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET: "test-secret",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3000",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS: "300",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS: "3",
    });

    expect(loaded.auth).toEqual({
      baseUrl: "http://127.0.0.1:5000",
      secret: "test-secret",
      trustedOrigins: ["http://127.0.0.1:3000"],
      otpLength: 6,
      otpExpiresInSeconds: 300,
      otpAllowedAttempts: 3,
    });
  });

  it("loads google auth config from env when fully configured", () => {
    const loaded = loadControlPlaneApiFromEnv({
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: "http://127.0.0.1:5000",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET: "test-secret",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3000",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS: "300",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS: "3",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID: "google-client-id",
      MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_SECRET: "google-client-secret",
    });

    expect(loaded.auth).toEqual({
      baseUrl: "http://127.0.0.1:5000",
      secret: "test-secret",
      trustedOrigins: ["http://127.0.0.1:3000"],
      otpLength: 6,
      otpExpiresInSeconds: 300,
      otpAllowedAttempts: 3,
      google: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
      },
    });
  });

  it("fails fast when only one google env var is set", () => {
    expect(() =>
      loadControlPlaneApiFromEnv({
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: "http://127.0.0.1:5000",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_SECRET: "test-secret",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:3000",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_LENGTH: "6",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_EXPIRES_IN_SECONDS: "300",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_OTP_ALLOWED_ATTEMPTS: "3",
        MISTLE_APPS_CONTROL_PLANE_API_AUTH_GOOGLE_CLIENT_ID: "google-client-id",
      }),
    ).toThrow("clientSecret");
  });
});

describe("control-plane api commit-sign config", () => {
  it("loads commit-sign config from env when configured", () => {
    const loaded = loadControlPlaneApiFromEnv({
      MISTLE_APPS_CONTROL_PLANE_API_COMMIT_SIGN_BINARY_PATH:
        "/repo/packages/commit-sign/target/debug/commit-sign",
    });

    expect(loaded.commitSign).toEqual({
      binaryPath: "/repo/packages/commit-sign/target/debug/commit-sign",
    });
  });
});
