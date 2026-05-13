import { spawn } from "node:child_process";

import { z } from "zod";

export const SshSigningFormat = "ssh";
export const CommitSignSignatureEncoding = "pem";
export const DefaultCommitSignBinaryPath = "/usr/local/bin/commit-sign";

export const CommitSignResponseSchema = z
  .object({
    format: z.literal(SshSigningFormat),
    signature: z.string().min(1),
    signatureEncoding: z.literal(CommitSignSignatureEncoding),
  })
  .strict();

export type CommitSignResult = z.infer<typeof CommitSignResponseSchema>;

export async function runCommitSignBinary(input: {
  binaryPath: string;
  format: typeof SshSigningFormat;
  privateKey: string;
  payloadBase64: string;
}): Promise<CommitSignResult> {
  const child = spawn(input.binaryPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  });

  const requestPayload = JSON.stringify({
    format: input.format,
    privateKey: input.privateKey,
    payloadBase64: input.payloadBase64,
  });
  child.stdin.end(requestPayload);

  const { exitCode, signal } = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (closeCode, closeSignal) => {
      resolve({
        exitCode: closeCode,
        signal: closeSignal,
      });
    });
  });
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

  if (exitCode !== 0) {
    const failureMessage =
      stderr.length > 0
        ? stderr
        : `commit-sign exited with code ${String(exitCode)}${signal === null ? "" : ` (signal ${signal})`}.`;
    throw new Error(`commit-sign failed: ${failureMessage}`);
  }

  const parsedOutput: unknown = JSON.parse(stdout);
  return CommitSignResponseSchema.parse(parsedOutput);
}
