import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import { SandboxProvider } from "../../src/index.js";
import { e2bAdapterIntegrationEnabled, it } from "./test-context.js";

const describeE2BAdapterIntegration = e2bAdapterIntegrationEnabled ? describe : describe.skip;
const SANDBOX_STATE_FILE_PATH = "/tmp/mistle-e2b-state.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

describeE2BAdapterIntegration("e2b adapter integration", () => {
  it("starts a sandbox from the shared base image and injects env", async ({ fixture }) => {
    const injectedEnvValue = `mistle-e2b-env-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      id = sandbox.id;

      expect(sandbox.provider).toBe(SandboxProvider.E2B);
      expect(sandbox.id).not.toBe("");

      const connectedSandbox = await fixture.connectSandbox(sandbox.id);
      const result = await connectedSandbox.commands.run(`printf '%s' "$${INJECTED_ENV_KEY}"`);

      expect(result.stdout).toBe(injectedEnvValue);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("stops and resumes the same sandbox while preserving filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-e2b-state-${randomUUID()}`;
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      id = sandbox.id;

      const startedSandbox = await fixture.connectSandbox(sandbox.id);
      await startedSandbox.files.write(SANDBOX_STATE_FILE_PATH, marker);

      await fixture.adapter.stop({ id: sandbox.id });

      const resumedSandbox = await fixture.adapter.resume({
        id: sandbox.id,
      });
      expect(resumedSandbox.id).toBe(sandbox.id);

      const connectedResumedSandbox = await fixture.connectSandbox(resumedSandbox.id);
      const readback = await connectedResumedSandbox.files.read(SANDBOX_STATE_FILE_PATH);

      expect(readback).toBe(marker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);
});
