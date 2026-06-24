export const GoogleCapabilityIds: {
  GOOGLE_ANALYTICS: "google_analytics";
  GOOGLE_SEARCH_CONSOLE: "google_search_console";
  GOOGLE_BUSINESS_PROFILE: "google_business_profile";
  GCP_CLOUD_LOGGING: "gcp_cloud_logging";
  GCP_CLOUD_RUN: "gcp_cloud_run";
  GCP_CLOUD_STORAGE: "gcp_cloud_storage";
  GCP_CLOUD_RESOURCE_MANAGER: "gcp_cloud_resource_manager";
  GCP_GKE: "gcp_gke";
} = {
  GOOGLE_ANALYTICS: "google_analytics",
  GOOGLE_SEARCH_CONSOLE: "google_search_console",
  GOOGLE_BUSINESS_PROFILE: "google_business_profile",
  GCP_CLOUD_LOGGING: "gcp_cloud_logging",
  GCP_CLOUD_RUN: "gcp_cloud_run",
  GCP_CLOUD_STORAGE: "gcp_cloud_storage",
  GCP_CLOUD_RESOURCE_MANAGER: "gcp_cloud_resource_manager",
  GCP_GKE: "gcp_gke",
};

export type GoogleCapabilityCatalogEntry = {
  id: string;
  label: string;
  groupId: string;
  requiredScopes: readonly string[];
};

export type GoogleCapabilityGroup = {
  id: string;
  label: string;
  capabilityIds: readonly string[];
};

export const GoogleCapabilityCatalog: readonly GoogleCapabilityCatalogEntry[] = [
  {
    id: GoogleCapabilityIds.GOOGLE_ANALYTICS,
    label: "Google Analytics",
    groupId: "marketing_analytics",
    requiredScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  },
  {
    id: GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE,
    label: "Google Search Console",
    groupId: "marketing_analytics",
    requiredScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  },
  {
    id: GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE,
    label: "Google Business Profile",
    groupId: "marketing_analytics",
    requiredScopes: ["https://www.googleapis.com/auth/business.manage"],
  },
  {
    id: GoogleCapabilityIds.GCP_CLOUD_LOGGING,
    label: "Cloud Logging",
    groupId: "google_cloud",
    requiredScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
  {
    id: GoogleCapabilityIds.GCP_CLOUD_RUN,
    label: "Cloud Run",
    groupId: "google_cloud",
    requiredScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
  {
    id: GoogleCapabilityIds.GCP_CLOUD_STORAGE,
    label: "Cloud Storage",
    groupId: "google_cloud",
    requiredScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
  {
    id: GoogleCapabilityIds.GCP_CLOUD_RESOURCE_MANAGER,
    label: "Cloud Resource Manager",
    groupId: "google_cloud",
    requiredScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
  {
    id: GoogleCapabilityIds.GCP_GKE,
    label: "Google Kubernetes Engine",
    groupId: "google_cloud",
    requiredScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  },
];

export const GoogleCapabilityGroups: readonly GoogleCapabilityGroup[] = [
  {
    id: "marketing_analytics",
    label: "Marketing & analytics",
    capabilityIds: [
      GoogleCapabilityIds.GOOGLE_ANALYTICS,
      GoogleCapabilityIds.GOOGLE_SEARCH_CONSOLE,
      GoogleCapabilityIds.GOOGLE_BUSINESS_PROFILE,
    ],
  },
  {
    id: "google_cloud",
    label: "Google Cloud",
    capabilityIds: [
      GoogleCapabilityIds.GCP_CLOUD_LOGGING,
      GoogleCapabilityIds.GCP_CLOUD_RUN,
      GoogleCapabilityIds.GCP_CLOUD_STORAGE,
      GoogleCapabilityIds.GCP_CLOUD_RESOURCE_MANAGER,
      GoogleCapabilityIds.GCP_GKE,
    ],
  },
];

export function listRequiredGoogleCapabilityScopes(
  capabilityIds: readonly string[],
): readonly string[] {
  const selectedCapabilityIds = new Set(capabilityIds);
  const scopes = new Set<string>();

  for (const capability of GoogleCapabilityCatalog) {
    if (!selectedCapabilityIds.has(capability.id)) {
      continue;
    }

    for (const scope of capability.requiredScopes) {
      scopes.add(scope);
    }
  }

  return [...scopes].sort();
}
