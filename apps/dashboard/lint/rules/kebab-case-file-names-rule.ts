import { createShellCheckRule } from "../lib/create-shell-check-rule.ts";

export const KebabCaseFileNamesRule = createShellCheckRule({
  description: "Ensure dashboard files and folders use kebab-case naming.",
  command: "pnpm",
  args: ["exec", "tsx", "./lint/check-file-names.ts"],
});
