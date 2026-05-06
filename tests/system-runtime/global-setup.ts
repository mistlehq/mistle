import {
  cleanupStaleRunnerServicePools,
  ensureRunnerPoolSession,
  stopRunnerServicePools,
} from "@mistle/test-harness";

export default async function setup(): Promise<() => Promise<void>> {
  await cleanupStaleRunnerServicePools();
  const session = ensureRunnerPoolSession(process.env);

  return async () => {
    await stopRunnerServicePools({
      runId: session.runId,
      coordinatorDir: session.coordinatorDir,
    });
  };
}
