import {
  generateSandboxSessionProtocolTypesToTemporarySource,
  readGeneratedTypesFile,
} from "./protocol-client.js";

async function run(): Promise<void> {
  const result = await generateSandboxSessionProtocolTypesToTemporarySource();
  const currentSource = await readGeneratedTypesFile(result.generatedTypesPath);

  if (currentSource === null) {
    throw new Error(
      `Generated schema does not exist at ${result.generatedTypesPath}. Run: pnpm --filter @mistle/sandbox-session-protocol protocol:generate`,
    );
  }

  if (currentSource !== result.schemaSource) {
    throw new Error(
      [
        "Sandbox session protocol types are out of date.",
        `Generated: ${result.generatedTypesPath}`,
        "Run: pnpm --filter @mistle/sandbox-session-protocol protocol:generate",
      ].join("\n"),
    );
  }

  console.log(`Sandbox session protocol types are current: ${result.generatedTypesPath}`);
}

void run().catch((error: unknown) => {
  console.error("Sandbox session protocol type drift check failed", error);
  process.exit(1);
});
