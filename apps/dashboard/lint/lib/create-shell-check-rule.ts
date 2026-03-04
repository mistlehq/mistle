import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuleModule } from "../types/plugin-types.ts";

const DashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function runCheckCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: DashboardRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  const renderedCommand = formatCommand(command, args);

  if (result.error !== undefined) {
    return `${renderedCommand} failed: ${result.error.message}`;
  }

  if ((result.status ?? 1) === 0) {
    return null;
  }

  const output = [result.stderr.trim(), result.stdout.trim()].filter((line) => line.length > 0);
  return [`${renderedCommand} failed.`, ...output].join("\n");
}

interface ShellCheckInput {
  description: string;
  command: string;
  args: string[];
}

export function createShellCheckRule(input: ShellCheckInput): RuleModule {
  interface ShellCheckState {
    checked: boolean;
    error: string | null;
    reported: boolean;
  }

  const state: ShellCheckState = {
    checked: false,
    error: null,
    reported: false,
  };

  return {
    meta: {
      type: "problem",
      docs: {
        description: input.description,
      },
      schema: [],
      messages: {
        checkFailed: "{{details}}",
      },
    },
    create(context) {
      return {
        Program(node) {
          if (!state.checked) {
            state.checked = true;
            state.error = runCheckCommand(input.command, input.args);
          }

          if (state.error === null || state.reported) {
            return;
          }

          state.reported = true;
          context.report({
            node,
            messageId: "checkFailed",
            data: {
              details: state.error,
            },
          });
        },
      };
    },
  };
}
