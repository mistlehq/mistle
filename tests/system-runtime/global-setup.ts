import { ensureRunnerPoolSession, stopRunnerServicePools } from "@mistle/test-harness";

export default async function setup(): Promise<() => Promise<void>> {
  const session = ensureRunnerPoolSession(process.env);

  return async () => {
    await stopRunnerServicePools({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
    });
  };
}
