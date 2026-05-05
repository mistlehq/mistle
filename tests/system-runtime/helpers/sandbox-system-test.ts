import {
  createSystemTest,
  type CreateSystemTestInput,
  type RuntimeSystemTestEnvironment,
  type SystemTestSandboxProvider,
} from "@mistle/test-harness/system";

export type SandboxSystemTestProvider = SystemTestSandboxProvider;

export type SandboxSystemTestFixture = {
  system: RuntimeSystemTestEnvironment;
  sandboxProvider: SandboxSystemTestProvider;
};

type SandboxSystemTestCallback = (fixture: SandboxSystemTestFixture) => Promise<void> | void;

type SandboxSystemTest = (
  name: string,
  callback: SandboxSystemTestCallback,
  timeout?: number,
) => void;

export type CreateSandboxSystemTestInput = Omit<CreateSystemTestInput, "sandbox"> & {
  sandboxProviders: readonly SandboxSystemTestProvider[];
};

export function createSandboxSystemTest(input: CreateSandboxSystemTestInput): SandboxSystemTest {
  const providerTests = input.sandboxProviders.map((sandboxProvider) => ({
    sandboxProvider,
    it: createSystemTest({
      ...input,
      ...(sandboxProvider === "e2b" && input.publicAccess !== undefined
        ? { publicAccess: input.publicAccess }
        : {}),
      sandbox: {
        provider: sandboxProvider,
      },
    }),
  }));

  return (name, callback, timeout) => {
    for (const providerTest of providerTests) {
      providerTest.it(
        `${name} [${providerTest.sandboxProvider}]`,
        async ({ system }) => {
          await callback({
            system,
            sandboxProvider: providerTest.sandboxProvider,
          });
        },
        timeout,
      );
    }
  };
}
