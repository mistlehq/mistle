import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import { SandboxProvider, SandboxRuntimeEnv, SandboxRuntimeEnvDefaults } from "../../src/index.js";
import { createE2BTemplateAlias } from "../../src/providers/e2b/template-registry.js";
import { e2bAdapterIntegrationEnabled, it } from "./test-context.js";

const describeE2BAdapterIntegration = e2bAdapterIntegrationEnabled ? describe : describe.skip;
const SANDBOX_STATE_FILE_PATH = "/tmp/mistle-e2b-state.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";

describeE2BAdapterIntegration("e2b adapter integration", () => {
  it("reuses the same template alias for the same base image", async ({ fixture }) => {
    const firstRegistry = fixture.createTemplateRegistry();
    const secondRegistry = fixture.createTemplateRegistry();
    const firstAlias = await firstRegistry.resolveAlias(fixture.baseImage.imageId);
    const secondAlias = await secondRegistry.resolveAlias(fixture.baseImage.imageId);

    expect(secondAlias).toBe(firstAlias);
  }, 300_000);

  it("starts a sandbox from the shared base image and injects env", async ({ fixture }) => {
    const injectedEnvValue = `mistle-e2b-env-${randomUUID()}`;
    const expectedTemplateAlias = createE2BTemplateAlias(fixture.baseImage.imageId);
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

      const inspection = await fixture.adapter.inspect({ id: sandbox.id });
      expect(inspection.provider).toBe(SandboxProvider.E2B);
      if (inspection.provider !== SandboxProvider.E2B) {
        throw new Error("Expected E2B sandbox inspection result.");
      }
      expect(inspection.id).toBe(sandbox.id);
      expect(inspection.state).toBe("running");
      expect(inspection.raw.templateId).not.toBe("");
      expect(inspection.raw.metadata.mistle_template_alias).toBe(expectedTemplateAlias);
      expect(inspection.raw.cpuCount).toBeGreaterThan(0);
      expect(inspection.raw.memoryMB).toBeGreaterThan(0);

      const connectedSandbox = await fixture.connectSandbox(sandbox.id);
      const result = await connectedSandbox.commands.run(
        `printf '%s\\n%s\\n%s' "$${INJECTED_ENV_KEY}" "$${SandboxRuntimeEnv.LISTEN_ADDR}" "$${SandboxRuntimeEnv.USER}"`,
      );

      expect(result.stdout).toBe(
        [
          injectedEnvValue,
          SandboxRuntimeEnvDefaults.LISTEN_ADDR,
          SandboxRuntimeEnvDefaults.USER,
        ].join("\n"),
      );
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
    const expectedTemplateAlias = createE2BTemplateAlias(fixture.baseImage.imageId);
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      id = sandbox.id;

      const startedSandbox = await fixture.connectSandbox(sandbox.id);
      await startedSandbox.files.write(SANDBOX_STATE_FILE_PATH, marker);

      await fixture.adapter.stop({ id: sandbox.id });

      const stoppedInspection = await fixture.adapter.inspect({ id: sandbox.id });
      if (stoppedInspection.provider !== SandboxProvider.E2B) {
        throw new Error("Expected E2B sandbox inspection result after stop.");
      }
      expect(stoppedInspection.state).toBe("stopped");
      expect(stoppedInspection.raw.metadata.mistle_template_alias).toBe(expectedTemplateAlias);

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
