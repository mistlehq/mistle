import { createControlPlaneDatabase, sandboxProfiles } from "@mistle/db/control-plane";
import { SMTPEmailSender } from "@mistle/emails";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";

import type {
  ControlPlaneWorkerConfig,
  ControlPlaneWorkerRuntime,
  StartedServer,
} from "./types.js";

import { createApp } from "./app.js";
import { startServer } from "./server.js";

export async function createControlPlaneWorkerRuntime(
  config: ControlPlaneWorkerConfig,
): Promise<ControlPlaneWorkerRuntime> {
  const app = createApp();
  const dbPool = new Pool({
    connectionString: config.workflow.databaseUrl,
  });
  const db = createControlPlaneDatabase(dbPool);
  let backend: Awaited<ReturnType<typeof createControlPlaneBackend>>;
  try {
    backend = await createControlPlaneBackend({
      url: config.workflow.databaseUrl,
      namespaceId: config.workflow.namespaceId,
      runMigrations: config.workflow.runMigrations,
    });
  } catch (error) {
    await dbPool.end();
    throw error;
  }
  const openWorkflow = createControlPlaneOpenWorkflow({ backend });
  const emailSender = SMTPEmailSender.fromTransportOptions({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    auth: {
      user: config.email.smtpUsername,
      pass: config.email.smtpPassword,
    },
  });
  const worker = createControlPlaneWorker({
    openWorkflow,
    concurrency: config.workflow.concurrency,
    workflowInputs: {
      sendVerificationOTP: {
        emailSender,
        from: {
          email: config.email.fromAddress,
          name: config.email.fromName,
        },
      },
      requestDeleteSandboxProfile: {
        deleteSandboxProfile: async (input) => {
          await db
            .delete(sandboxProfiles)
            .where(
              and(
                eq(sandboxProfiles.id, input.profileId),
                eq(sandboxProfiles.organizationId, input.organizationId),
              ),
            );
        },
      },
    },
  });
  let startedServer: StartedServer | undefined;
  let workerStarted = false;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (workerStarted) {
      await worker.stop();
      workerStarted = false;
    }

    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    await Promise.all([backend.stop(), dbPool.end()]);
    stopped = true;
  }

  return {
    app,
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Control plane worker runtime is already stopped.");
      }
      if (startedServer !== undefined || workerStarted) {
        throw new Error("Control plane worker runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: config.server.host,
        port: config.server.port,
      });

      try {
        await worker.start();
        workerStarted = true;
      } catch (error) {
        await startedServer.close();
        startedServer = undefined;
        throw error;
      }
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      if (stopPromise !== undefined) {
        await stopPromise;
        return;
      }

      stopPromise = stopRuntimeResources();

      await stopPromise;
    },
  };
}
