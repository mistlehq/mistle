import { describe, expect } from "vitest";

import { RequestDeleteSandboxProfileWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("request delete sandbox profile workflow integration", () => {
  it("deletes the matching sandbox profile", async ({ fixture }) => {
    const organizationId = "org_workflow_tests";
    const profileId = "sbp_workflow_tests";
    const otherProfileId = "sbp_workflow_other";

    await fixture.sql`
      insert into control_plane.organizations (id, name, slug)
      values (${organizationId}, 'Workflow test organization', 'workflow-test-org')
      on conflict (id) do nothing
    `;

    await fixture.sql`
      insert into control_plane.sandbox_profiles (id, organization_id, display_name, status)
      values
        (${profileId}, ${organizationId}, 'Profile to delete', 'active'),
        (${otherProfileId}, ${organizationId}, 'Profile to keep', 'active')
    `;

    const handle = await fixture.openWorkflow.runWorkflow(RequestDeleteSandboxProfileWorkflowSpec, {
      organizationId,
      profileId,
    });
    const result = await handle.result({ timeoutMs: 10_000 });
    expect(result.profileId).toBe(profileId);

    const deletedProfileRows = await fixture.sql`
      select id
      from control_plane.sandbox_profiles
      where id = ${profileId}
    `;
    expect(deletedProfileRows).toHaveLength(0);

    const remainingProfileRows = await fixture.sql`
      select id
      from control_plane.sandbox_profiles
      where id = ${otherProfileId}
    `;
    expect(remainingProfileRows).toHaveLength(1);
  }, 90_000);
});
