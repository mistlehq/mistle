import { logger } from "../src/logger.js";
import {
  loadDevScheduleDispatcherConfig,
  startDevScheduleDispatcher,
} from "./schedule-dispatcher-dev.js";

const dispatcher = startDevScheduleDispatcher({
  config: loadDevScheduleDispatcherConfig(process.env),
});

logger.info(
  {
    eventName: "schedule.dev_dispatcher.started",
  },
  "Started dev schedule dispatcher.",
);

function shutdown(): void {
  dispatcher.stop();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
