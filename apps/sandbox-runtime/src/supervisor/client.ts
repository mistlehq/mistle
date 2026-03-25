import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { type Readable } from "node:stream";

import { readJsonObjectFromStream } from "../io/read-json-object-from-stream.js";
import { DefaultStartupInputMaxBytes, readStartupInput } from "../runtime/read-startup-input.js";
import { loadSupervisorConfig } from "./config.js";
import { DefaultSupervisorMessageMaxBytes, parseStartupApplyResponsePayload } from "./protocol.js";

type LookupEnv = (key: string) => string | undefined;

type ApplyStartupToSupervisorInput = {
  lookupEnv: LookupEnv;
  stdin: Readable;
};

async function readStartupToken(tokenPath: string): Promise<string> {
  let rawToken: string;
  try {
    rawToken = await readFile(tokenPath, "utf8");
  } catch (error) {
    if ((error instanceof Error && "code" in error && error.code === "ENOENT") || false) {
      throw new Error(
        "sandbox startup token is unavailable because startup may already be applied",
      );
    }

    throw error;
  }

  const token = rawToken.trim();
  if (token.length === 0) {
    throw new Error(`startup apply token file "${tokenPath}" is empty`);
  }

  return token;
}

export async function applyStartupToSupervisor(
  input: ApplyStartupToSupervisorInput,
): Promise<void> {
  const startupInput = await readStartupInput({
    reader: input.stdin,
    maxBytes: DefaultStartupInputMaxBytes,
  });
  const config = loadSupervisorConfig(input.lookupEnv);
  const token = await readStartupToken(config.tokenPath);

  const socket = createConnection(config.socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.end(
    JSON.stringify({
      token,
      startupInput,
    }),
  );

  const rawResponse = await readJsonObjectFromStream({
    reader: socket,
    maxBytes: DefaultSupervisorMessageMaxBytes,
    label: "startup apply response",
  });

  let payload: unknown;
  try {
    payload = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error(
      `startup apply response must be valid json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const response = parseStartupApplyResponsePayload(payload);
  if (!response.ok) {
    throw new Error(response.error);
  }
}
