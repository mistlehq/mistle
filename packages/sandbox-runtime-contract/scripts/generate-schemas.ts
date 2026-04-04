import { writeFile } from "node:fs/promises";

import { SandboxKeepaliveStateSchema } from "../src/keepalive.js";
import { SandboxRuntimeStateSnapshotSchema } from "../src/runtime-state.js";
import {
  SandboxdStartupApplyRequestSchema,
  SandboxdStartupApplyResponseSchema,
  SandboxdStartupInputSchema,
} from "../src/startup.js";

const StartupJsonSchemaParams = {
  io: "input",
} as const;

const SchemaOutputs = [
  {
    outputPath: new URL("../schemas/sandboxd-startup-input.schema.json", import.meta.url),
    schema: SandboxdStartupInputSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandboxd-startup-apply-request.schema.json", import.meta.url),
    schema: SandboxdStartupApplyRequestSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandboxd-startup-apply-response.schema.json", import.meta.url),
    schema: SandboxdStartupApplyResponseSchema.toJSONSchema(StartupJsonSchemaParams),
  },
  {
    outputPath: new URL("../schemas/sandbox-keepalive-state.schema.json", import.meta.url),
    schema: SandboxKeepaliveStateSchema.toJSONSchema(),
  },
  {
    outputPath: new URL("../schemas/sandbox-runtime-state-snapshot.schema.json", import.meta.url),
    schema: SandboxRuntimeStateSnapshotSchema.toJSONSchema(),
  },
] as const;

await Promise.all(
  SchemaOutputs.map(({ outputPath, schema }) =>
    writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`),
  ),
);
