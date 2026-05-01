import type { RequestInit as TestHttpRequestInit, Response as TestHttpResponse } from "undici";

/**
 * How a Mistle app is started for a test environment.
 *
 * The generic environment layer is policy-neutral about launch modes. Specific
 * environment factories can choose to restrict these later.
 */
export type TestServiceLaunchMode = "runtime" | "process" | "docker";

/**
 * Provisions all logical resources for one infrastructure kind.
 *
 * Receiving the full requirement list lets one provisioner dedupe physical
 * Testcontainers resources while still creating isolated logical state.
 */
export type TestInfraProvisioner = {
  kind: string;
  provision: (input: TestInfraProvisionInput) => Promise<readonly ResolvedTestInfra[]>;
};

/**
 * A logical infrastructure reference declared by a service.
 *
 * The `id` identifies the logical resource, not the physical container. Multiple
 * services can share one requirement id when they intentionally share the same
 * logical resource. Any isolation policy belongs in the provisioner and the test
 * environment setup, not in this generic graph node.
 */
export type TestInfraRequirement = {
  id: string;
  kind: string;
  provisioner: TestInfraProvisioner;
};

/**
 * A provisioned logical infrastructure resource.
 *
 * `values` is intentionally string-only so provisioners can expose connection
 * URLs, prefixes, bucket names, and similar wiring without coupling this generic
 * graph layer to a specific infrastructure type.
 */
export type ResolvedTestInfra = {
  id: string;
  kind: string;
  values: ReadonlyMap<string, string>;
  stop: () => Promise<void>;
};

export type TestServiceHttpEndpoint = {
  hostBaseUrl: string;
  internalBaseUrl?: string;
};

export type TestServiceEndpoints = {
  http?: TestServiceHttpEndpoint;
};

export type TestServiceEndpointPlan = {
  http?: {
    host: string;
  };
};

export type TestServiceRuntime = {
  endpoints: TestServiceEndpoints;
  pid?: number;
  containerId?: string;
};

/**
 * A started Mistle service, regardless of whether it was launched in-process,
 * as a local child process, or in a container.
 */
export type TestService = TestServiceRuntime & {
  id: string;
  mode: TestServiceLaunchMode;
  isPooled?: true;
  stop: () => Promise<void>;
};

/** Reusable HTTP client bound to one started service's base URL. */
export type TestHttpClient = {
  fetch: (path: string | URL, init?: TestHttpRequestInit) => Promise<TestHttpResponse>;
  close: () => Promise<void>;
};

/** Test-facing service handle with harness-managed clients attached when present. */
export type TestServiceHandle = TestService & {
  http?: TestHttpClient;
  start: () => Promise<void>;
  restart: () => Promise<void>;
};

/**
 * Input passed to a service launcher after infrastructure and reference
 * services have been resolved.
 */
export type TestServiceStartInput = {
  environmentId: string;
  mode: TestServiceLaunchMode;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  services: ReadonlyMap<string, TestServiceHandle>;
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>;
};

/**
 * Generic service definition consumed by the test environment planner.
 *
 * Concrete Mistle service registries should build these definitions near test
 * composition code, where importing multiple app runtime factories is allowed.
 */
export type TestServiceDefinition = {
  id: string;
  infra: readonly TestInfraRequirement[];
  serviceReferences: readonly string[];
  endpoints?: TestServiceEndpointPlan;
  /**
   * Services are runner-pooled by default. Worker services should use
   * `environment` because OpenWorkflow workers are bound to one namespace.
   */
  poolScope?: "runner" | "environment";
  supportedModes: readonly TestServiceLaunchMode[];
  healthCheck: (service: TestServiceRuntime) => Promise<void>;
  start: (input: TestServiceStartInput) => Promise<TestService>;
};

/** Concrete service registry keyed by the service ids callers request. */
export type TestServiceRegistry = {
  readonly [serviceId: string]: TestServiceDefinition;
};

/** One caller-facing service selection for a registry-backed environment. */
export type TestServiceSelection<TRegistry extends TestServiceRegistry> = {
  readonly [TServiceId in Extract<keyof TRegistry, string>]: {
    service: TServiceId;
    mode: TRegistry[TServiceId]["supportedModes"][number];
  };
}[Extract<keyof TRegistry, string>];

/** A selected service plus the launch mode requested by one environment. */
export type TestServiceRequest = {
  service: TestServiceDefinition;
  mode: TestServiceLaunchMode;
};

/** Registry-backed environment input using type-safe service ids and modes. */
export type TestEnvironmentRegistryInput<TRegistry extends TestServiceRegistry> = {
  id?: string;
  registry: TRegistry;
  services: readonly TestServiceSelection<TRegistry>[];
};

export type SelectedTestServiceId<
  TServices extends readonly TestServiceSelection<TestServiceRegistry>[],
> = Extract<TServices[number]["service"], string>;

/**
 * Test-facing view of started services.
 *
 * Native `Map.get` has to return `undefined`; this collection is stricter
 * because it is built from the service selections passed to `startTestEnvironment`.
 */
export type TestServiceCollection<TServiceId extends string = string> = {
  get: <TRequestedServiceId extends TServiceId>(
    serviceId: TRequestedServiceId,
  ) => TestServiceHandle;
  keys: () => readonly string[];
  values: () => readonly TestServiceHandle[];
};

/** Requirements passed to the provisioner that owns one infra kind. */
export type TestInfraProvisionInput = {
  environmentId: string;
  requirements: readonly TestInfraRequirement[];
};

/** Planned infra requirements and service startup layers. */
export type TestEnvironmentPlan = {
  infraRequirements: readonly TestInfraRequirement[];
  serviceLayers: readonly (readonly TestServiceRequest[])[];
};

/** Handle returned by a started test environment. */
export type TestEnvironment<TServiceId extends string = string> = {
  id: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
  services: TestServiceCollection<TServiceId>;
  stop: () => Promise<void>;
};
