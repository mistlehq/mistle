import { generateSandboxSessionProtocolTypesFile } from "./protocol-client.js";

async function run(): Promise<void> {
  const result = await generateSandboxSessionProtocolTypesFile();

  console.log(`Generated sandbox session protocol types: ${result.generatedTypesPath}`);
}

void run().catch((error: unknown) => {
  console.error("Failed to generate sandbox session protocol types", error);
  process.exit(1);
});
