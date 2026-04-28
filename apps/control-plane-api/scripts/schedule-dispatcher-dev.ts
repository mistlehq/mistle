import { AppIds, loadConfig } from "@mistle/config";
import {
  type Clock,
  type Scheduler,
  systemClock,
  systemScheduler,
  type TimerHandle,
} from "@mistle/time";

import { logger } from "../src/logger.js";

const DispatchPath = "/internal/schedules/dispatch";
const MinuteMs = 60_000;
const StartupRetryDelayMs = 1_000;

export type DevScheduleDispatcherConfig = Readonly<{
  baseUrl: string;
  serviceToken: string;
}>;

export type DevScheduleDispatcherHandle = Readonly<{
  stop: () => void;
}>;

export function resolveDelayToNextMinuteMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Cannot schedule dispatch for a non-finite timestamp.");
  }

  const remainder = nowMs % MinuteMs;
  return remainder === 0 ? 0 : MinuteMs - remainder;
}

export function loadDevScheduleDispatcherConfig(
  env: NodeJS.ProcessEnv,
): DevScheduleDispatcherConfig {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env,
    includeGlobal: false,
  });
  const host =
    loadedConfig.app.server.host === "0.0.0.0" ? "127.0.0.1" : loadedConfig.app.server.host;

  return {
    baseUrl: `http://${host}:${String(loadedConfig.app.server.port)}`,
    serviceToken: loadedConfig.app.internalAuth.serviceToken,
  };
}

export async function dispatchSchedulesOnce(config: DevScheduleDispatcherConfig): Promise<void> {
  const response = await fetch(new URL(DispatchPath, config.baseUrl), {
    method: "POST",
    headers: {
      "x-mistle-service-token": config.serviceToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Schedule dispatch request failed with status ${String(response.status)}.`);
  }
}

export function startDevScheduleDispatcher(input: {
  clock?: Clock;
  config: DevScheduleDispatcherConfig;
  scheduler?: Scheduler;
}): DevScheduleDispatcherHandle {
  const clock = input.clock ?? systemClock;
  const scheduler = input.scheduler ?? systemScheduler;
  let stopped = false;
  let timerHandle: TimerHandle | undefined;
  let hasDispatchedSuccessfully = false;

  function scheduleNext(delayMs: number): void {
    timerHandle = scheduler.schedule(() => {
      void tick();
    }, delayMs);
  }

  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }

    try {
      await dispatchSchedulesOnce(input.config);
      hasDispatchedSuccessfully = true;
      logger.info(
        {
          eventName: "schedule.dev_dispatcher.dispatched",
        },
        "Dev schedule dispatcher called internal dispatch endpoint.",
      );
    } catch (error) {
      logger.warn(
        {
          err: error,
          eventName: "schedule.dev_dispatcher.dispatch_failed",
        },
        "Dev schedule dispatcher failed to call internal dispatch endpoint.",
      );
    }

    if (stopped) {
      return;
    }

    scheduleNext(
      hasDispatchedSuccessfully ? resolveDelayToNextMinuteMs(clock.nowMs()) : StartupRetryDelayMs,
    );
  }

  scheduleNext(resolveDelayToNextMinuteMs(clock.nowMs()));

  return {
    stop: () => {
      stopped = true;
      if (timerHandle !== undefined) {
        scheduler.cancel(timerHandle);
      }
    },
  };
}
