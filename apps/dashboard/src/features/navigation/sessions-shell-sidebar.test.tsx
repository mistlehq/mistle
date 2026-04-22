import { describe, expect, it } from "vitest";

import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { buildSessionsShellSidebarItems } from "./sessions-shell-sidebar.js";

function buildSandboxInstanceListItem(
  overrides: Partial<SandboxInstanceListItem> & Pick<SandboxInstanceListItem, "id">,
): SandboxInstanceListItem {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    title: null,
    sandboxProfileId: "sbp_default",
    sandboxProfileDisplayName: "Default Profile",
    sandboxProfileVersion: 1,
    status: "running",
    startedBy: {
      kind: "user",
      id: "usr_123",
      name: "Test User",
    },
    source: "dashboard",
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
    keepaliveActive: false,
    failureCode: null,
    failureMessage: null,
    ...restOverrides,
  };
}

describe("buildSessionsShellSidebarItems", () => {
  it("maps listed sandbox instances into flat session sidebar items without reordering", () => {
    expect(
      buildSessionsShellSidebarItems(
        [
          buildSandboxInstanceListItem({
            id: "sbi_active",
            title: "Investigate flaky test run",
            keepaliveActive: true,
          }),
          buildSandboxInstanceListItem({
            id: "sbi_setup",
            sandboxProfileId: "sbp_docs",
            sandboxProfileDisplayName: "Docs",
            title: "Draft onboarding guide",
            status: "starting",
          }),
          buildSandboxInstanceListItem({
            id: "sbi_failed",
            sandboxProfileId: "sbp_failed",
            sandboxProfileDisplayName: "Broken",
            status: "failed",
          }),
        ],
        {
          nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
        },
      ),
    ).toStrictEqual([
      {
        id: "sbi_active",
        label: "Investigate flaky test run",
        profileName: "Default Profile",
        status: "running",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_active",
      },
      {
        id: "sbi_setup",
        label: "Draft onboarding guide",
        profileName: "Docs",
        status: "starting",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_setup",
      },
      {
        id: "sbi_failed",
        label: "Untitled",
        profileName: "Broken",
        status: "failed",
        updatedAtLabel: "2d",
      },
    ]);
  });
});
