import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateSandboxSessionProtocolTypesToTemporarySource,
  readGeneratedTypesFile,
} from "../scripts/sandbox-session-protocol-client.js";

export async function checkSandboxSessionProtocolTypesDrift() {
  const result = await generateSandboxSessionProtocolTypesToTemporarySource();
  const currentSource = await readGeneratedTypesFile(result.generatedTypesPath);

  if (currentSource === null) {
    throw new Error(
      `Generated schema does not exist at ${result.generatedTypesPath}. Run: pnpm --filter @mistle/dashboard sandbox-session-protocol:generate`,
    );
  }

  if (currentSource !== result.schemaSource) {
    throw new Error(
      [
        "Dashboard sandbox session protocol types are out of date.",
        `Generated: ${result.generatedTypesPath}`,
        "Run: pnpm --filter @mistle/dashboard sandbox-session-protocol:generate",
      ].join("\n"),
    );
  }

  console.log(`Dashboard sandbox session protocol types are current: ${result.generatedTypesPath}`);
}

async function runCli() {
  try {
    await checkSandboxSessionProtocolTypesDrift();
  } catch (error) {
    console.error("Sandbox session protocol type drift check failed", error);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli();
}
