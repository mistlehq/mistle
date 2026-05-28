import {
  cleanupStaleRunnerServicePools,
  ensureRunnerPoolSession,
  prewarmRuntimeSystemSharedInfra,
  runCleanupTasks,
  stopRuntimeSystemSharedInfraForRun,
  stopRunnerServicePools,
} from "@mistle/test-harness";

export default async function setup(): Promise<() => Promise<void>> {
  await cleanupStaleRunnerServicePools();
  const session = ensureRunnerPoolSession(process.env);
  await prewarmRuntimeSystemSharedInfra();

  return async () => {
    await runCleanupTasks({
      context: "runtime system global teardown",
      tasks: [
        async () =>
          stopRunnerServicePools({
            runId: session.runId,
            coordinatorDir: session.coordinatorDir,
          }),
        async () =>
          stopRuntimeSystemSharedInfraForRun({
            runId: session.runId,
          }),
      ],
    });
  };
}
