import { AwsEndpointCatalog } from "./aws-endpoint-catalog.js";

export type AwsServiceEndpointMetadata = {
  regionalized: boolean;
  hostname?: string;
  signingRegion?: string;
};

export const AwsDnsSuffix = AwsEndpointCatalog.dnsSuffix;
export const AwsRegionIds = [...AwsEndpointCatalog.regionIds];
export const AwsServiceIds = [...AwsEndpointCatalog.serviceIds];
export const AwsRegionIdSet: ReadonlySet<string> = new Set(AwsRegionIds);
export const AwsServiceIdSet: ReadonlySet<string> = new Set(AwsServiceIds);
export const AwsEndpointMetadataByServiceId: Readonly<Record<string, AwsServiceEndpointMetadata>> =
  AwsEndpointCatalog.endpointMetadata;
