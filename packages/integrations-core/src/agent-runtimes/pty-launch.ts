import type { AgentPtyLaunchSpec, AgentPtyLaunchTemplate } from "./types.js";

export type ResolveAgentPtyLaunchTemplateResult = {
  ptySessionId: string;
  cols: number;
  rows: number;
  cwd?: string;
  command: string;
  args: string[];
};

function materializeAgentPtyLaunchArgs(
  template: AgentPtyLaunchTemplate,
  input: { threadId: string | null },
): string[] {
  return template.args.map((argument) => {
    if (argument.kind === "literal") {
      return argument.value;
    }

    if (input.threadId === null) {
      throw new Error("threadId is required to materialize a resume PTY launch template.");
    }

    return input.threadId;
  });
}

export function resolveAgentPtyLaunchTemplate(input: {
  launch: AgentPtyLaunchSpec;
  threadId: string | null;
}): ResolveAgentPtyLaunchTemplateResult {
  const template = input.threadId === null ? input.launch.newLaunch : input.launch.resumeLaunch;

  return {
    ptySessionId: template.ptySessionId,
    cols: template.cols,
    rows: template.rows,
    ...(template.cwd === undefined ? {} : { cwd: template.cwd }),
    command: template.command,
    args: materializeAgentPtyLaunchArgs(template, {
      threadId: input.threadId,
    }),
  };
}
