import { runCleanupTasks, type CleanupTask } from "./run-cleanup-tasks.js";

const ProcessCleanupTasks = new Map<number, CleanupTask>();
let nextProcessCleanupTaskId = 1;
let processHooksRegistered = false;
let cleanupDrainPromise: Promise<void> | undefined;
let fatalCleanupInProgress = false;

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

async function runRegisteredCleanupTasks(context: string): Promise<void> {
  const tasks = Array.from(ProcessCleanupTasks.entries())
    .reverse()
    .map(([, cleanupTask]) => cleanupTask);
  ProcessCleanupTasks.clear();

  await runCleanupTasks({
    tasks,
    context,
  });
}

async function handleFatalProcessEvent(input: {
  context: string;
  exitCode: number;
  error?: unknown;
}): Promise<void> {
  if (fatalCleanupInProgress) {
    return;
  }

  fatalCleanupInProgress = true;
  const originalError = input.error === undefined ? undefined : normalizeError(input.error);

  try {
    await drainProcessCleanupTasks(input.context);
  } catch (cleanupError) {
    console.error("Process cleanup failed while handling a fatal process event.");
    console.error(normalizeError(cleanupError));
  }

  if (originalError !== undefined) {
    console.error(originalError);
  }

  process.exit(input.exitCode);
}

function ensureProcessHooksRegistered(): void {
  if (processHooksRegistered) {
    return;
  }
  processHooksRegistered = true;

  process.once("SIGINT", () => {
    void handleFatalProcessEvent({
      context: "process cleanup after SIGINT",
      exitCode: signalExitCode("SIGINT"),
    });
  });

  process.once("SIGTERM", () => {
    void handleFatalProcessEvent({
      context: "process cleanup after SIGTERM",
      exitCode: signalExitCode("SIGTERM"),
    });
  });

  process.once("uncaughtException", (error) => {
    void handleFatalProcessEvent({
      context: "process cleanup after uncaughtException",
      exitCode: 1,
      error,
    });
  });

  process.once("unhandledRejection", (reason) => {
    void handleFatalProcessEvent({
      context: "process cleanup after unhandledRejection",
      exitCode: 1,
      error: reason,
    });
  });
}

export function registerProcessCleanupTask(task: CleanupTask): () => void {
  ensureProcessHooksRegistered();

  const processCleanupTaskId = nextProcessCleanupTaskId;
  nextProcessCleanupTaskId += 1;
  ProcessCleanupTasks.set(processCleanupTaskId, task);

  let unregistered = false;
  return () => {
    if (unregistered) {
      return;
    }

    unregistered = true;
    ProcessCleanupTasks.delete(processCleanupTaskId);
  };
}

export async function drainProcessCleanupTasks(context = "process cleanup"): Promise<void> {
  if (cleanupDrainPromise !== undefined) {
    return cleanupDrainPromise;
  }

  cleanupDrainPromise = runRegisteredCleanupTasks(context);
  try {
    await cleanupDrainPromise;
  } finally {
    cleanupDrainPromise = undefined;
  }
}
