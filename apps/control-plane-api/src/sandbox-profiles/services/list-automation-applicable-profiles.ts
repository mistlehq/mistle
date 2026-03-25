import {
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  sandboxProfiles,
  type SandboxProfile,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, desc, eq, inArray } from "drizzle-orm";

import { assertWebhookCapableTargetDefinition } from "../../automation-webhooks/services/assert-webhook-capable-target-definition.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type AutomationApplicableSandboxProfile = SandboxProfile & {
  latestVersion: number;
  eligibleIntegrationConnectionIds: string[];
};

type CandidateProfileRow = {
  id: string;
  organizationId: string;
  displayName: string;
  status: SandboxProfile["status"];
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
};

type LatestSandboxProfileRow = SandboxProfile & {
  latestVersion: number;
};

type CandidateBindingRow = {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  connectionId: string;
  familyId: string;
  variantId: string;
};

function toIsoLatestSandboxProfileRow(input: CandidateProfileRow): LatestSandboxProfileRow {
  return {
    ...input,
    createdAt: new Date(input.createdAt).toISOString(),
    updatedAt: new Date(input.updatedAt).toISOString(),
  };
}

function listLatestSandboxProfilesById(input: {
  candidateProfiles: readonly CandidateProfileRow[];
}): Map<string, LatestSandboxProfileRow> {
  const latestProfilesById = new Map<string, LatestSandboxProfileRow>();

  for (const profile of input.candidateProfiles) {
    if (latestProfilesById.has(profile.id)) {
      continue;
    }

    latestProfilesById.set(profile.id, toIsoLatestSandboxProfileRow(profile));
  }

  return latestProfilesById;
}

export async function listAutomationApplicableProfiles(
  {
    db,
    integrationRegistry,
  }: Pick<CreateSandboxProfilesServiceInput, "db"> & {
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
  },
): Promise<{
  items: AutomationApplicableSandboxProfile[];
}> {
  const candidateProfiles = await db
    .select({
      id: sandboxProfiles.id,
      organizationId: sandboxProfiles.organizationId,
      displayName: sandboxProfiles.displayName,
      status: sandboxProfiles.status,
      createdAt: sandboxProfiles.createdAt,
      updatedAt: sandboxProfiles.updatedAt,
      latestVersion: sandboxProfileVersions.version,
    })
    .from(sandboxProfiles)
    .innerJoin(
      sandboxProfileVersions,
      eq(sandboxProfileVersions.sandboxProfileId, sandboxProfiles.id),
    )
    .where(eq(sandboxProfiles.organizationId, input.organizationId))
    .orderBy(
      desc(sandboxProfiles.createdAt),
      desc(sandboxProfiles.id),
      desc(sandboxProfileVersions.version),
    );

  const latestProfilesById = listLatestSandboxProfilesById({
    candidateProfiles,
  });

  const latestProfileIds = [...latestProfilesById.keys()];
  if (latestProfileIds.length === 0) {
    return {
      items: [],
    };
  }

  const latestBindings: CandidateBindingRow[] = await db
    .select({
      sandboxProfileId: sandboxProfileVersionIntegrationBindings.sandboxProfileId,
      sandboxProfileVersion: sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
      connectionId: integrationConnections.id,
      familyId: integrationTargets.familyId,
      variantId: integrationTargets.variantId,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .innerJoin(
      integrationConnections,
      eq(integrationConnections.id, sandboxProfileVersionIntegrationBindings.connectionId),
    )
    .innerJoin(
      integrationTargets,
      eq(integrationTargets.targetKey, integrationConnections.targetKey),
    )
    .where(
      and(
        inArray(sandboxProfileVersionIntegrationBindings.sandboxProfileId, latestProfileIds),
        eq(integrationConnections.organizationId, input.organizationId),
        eq(integrationConnections.status, IntegrationConnectionStatuses.ACTIVE),
        eq(integrationTargets.enabled, true),
      ),
    );

  const eligibleConnectionIdsByProfileId = new Map<string, Set<string>>();
  for (const binding of latestBindings) {
    const profile = latestProfilesById.get(binding.sandboxProfileId);
    if (profile === undefined) {
      continue;
    }

    if (binding.sandboxProfileVersion !== profile.latestVersion) {
      continue;
    }

    try {
      if (
        !assertWebhookCapableTargetDefinition(integrationRegistry, {
          familyId: binding.familyId,
          variantId: binding.variantId,
        }).hasSupportedWebhookEvents
      ) {
        continue;
      }
    } catch {
      // Historical bindings may reference definitions that are no longer registered.
      // Treat those bindings as non-applicable instead of failing the whole listing.
      continue;
    }

    if (binding.sandboxProfileId === "") {
      continue;
    }

    const existingIds =
      eligibleConnectionIdsByProfileId.get(binding.sandboxProfileId) ?? new Set<string>();
    existingIds.add(binding.connectionId);
    eligibleConnectionIdsByProfileId.set(binding.sandboxProfileId, existingIds);
  }

  const items: AutomationApplicableSandboxProfile[] = [];
  for (const [profileId, eligibleConnectionIds] of eligibleConnectionIdsByProfileId) {
    const profile = latestProfilesById.get(profileId);
    if (profile === undefined || eligibleConnectionIds.size === 0) {
      continue;
    }

    items.push({
      ...profile,
      eligibleIntegrationConnectionIds: [...eligibleConnectionIds],
    });
  }

  items.sort((left, right) => {
    const createdAtDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (createdAtDifference !== 0) {
      return createdAtDifference;
    }

    return right.id.localeCompare(left.id);
  });

  return {
    items,
  };
}
