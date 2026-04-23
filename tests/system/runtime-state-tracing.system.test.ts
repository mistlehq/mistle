/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from shared system test context.
 */

import { randomUUID } from "node:crypto";

import {
  createDataPlaneDatabase,
  sandboxInstances,
  SandboxInstanceProviders,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { readCapturedOtlpRequests } from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./system-test-context.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const TracePollingIntervalMs = 100;
const TracePollingTimeoutMs = 15_000;

const OtlpAttributeSchema = z.looseObject({
  key: z.string(),
  value: z.looseObject({
    stringValue: z.string().optional(),
  }),
});

const OtlpSpanSchema = z.looseObject({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  attributes: z.array(OtlpAttributeSchema).optional(),
});

const OtlpScopeSpansSchema = z.looseObject({
  spans: z.array(OtlpSpanSchema).optional(),
});

const OtlpResourceSpansSchema = z.looseObject({
  resource: z
    .looseObject({
      attributes: z.array(OtlpAttributeSchema).optional(),
    })
    .optional(),
  scopeSpans: z.array(OtlpScopeSpansSchema).optional(),
});

const OtlpTraceExportSchema = z.looseObject({
  resourceSpans: z.array(OtlpResourceSpansSchema).optional(),
});

type RecordedSpan = {
  attributes: z.infer<typeof OtlpAttributeSchema>[] | undefined;
  name: string;
  serviceName: string;
  spanId: string;
  traceId: string;
};

function readStringAttribute(input: {
  attributes: z.infer<typeof OtlpAttributeSchema>[] | undefined;
  key: string;
}): string | undefined {
  const attribute = input.attributes?.find((item) => item.key === input.key);
  return attribute?.value.stringValue;
}

function collectRecordedSpans(
  otlpRequests: Awaited<ReturnType<typeof readCapturedOtlpRequests>>,
): RecordedSpan[] {
  const recordedSpans: RecordedSpan[] = [];

  for (const request of otlpRequests) {
    if (request.path !== "/v1/traces") {
      continue;
    }

    const parsedPayload: unknown = JSON.parse(request.body);
    const payload = OtlpTraceExportSchema.parse(parsedPayload);

    for (const resourceSpan of payload.resourceSpans ?? []) {
      const serviceName = readStringAttribute({
        attributes: resourceSpan.resource?.attributes,
        key: "service.name",
      });
      if (serviceName === undefined) {
        continue;
      }

      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        for (const span of scopeSpan.spans ?? []) {
          recordedSpans.push({
            attributes: span.attributes,
            name: span.name,
            serviceName,
            spanId: span.spanId,
            traceId: span.traceId,
          });
        }
      }
    }
  }

  return recordedSpans;
}

async function waitForSynchronousRuntimeStateTrace(input: {
  baselineRequestCount: number;
  otlpTraceCaptureFilePath: string;
}): Promise<{
  apiGatewayClientSpan: RecordedSpan;
  gatewaySpan: RecordedSpan;
}> {
  const deadlineMs = systemClock.nowMs() + TracePollingTimeoutMs;
  const runtimeStatePathPattern = /^\/internal\/sandbox-instances\/[^/]+\/runtime-state$/;

  while (systemClock.nowMs() < deadlineMs) {
    const capturedRequests = await readCapturedOtlpRequests(input.otlpTraceCaptureFilePath);
    const newRequests = capturedRequests.slice(input.baselineRequestCount);
    const recordedSpans = collectRecordedSpans(newRequests);
    const apiGatewayClientSpan = recordedSpans.find(
      (span) =>
        span.serviceName === "@mistle/data-plane-api" &&
        span.name === "GET" &&
        readStringAttribute({
          attributes: span.attributes,
          key: "server.address",
        }) === "data-plane-gateway" &&
        runtimeStatePathPattern.test(
          readStringAttribute({
            attributes: span.attributes,
            key: "url.path",
          }) ?? "",
        ),
    );

    if (apiGatewayClientSpan !== undefined) {
      const gatewaySpan = recordedSpans.find(
        (span) =>
          span.serviceName === "@mistle/data-plane-gateway" &&
          span.name === "GET" &&
          span.traceId === apiGatewayClientSpan.traceId &&
          runtimeStatePathPattern.test(
            readStringAttribute({
              attributes: span.attributes,
              key: "http.target",
            }) ??
              readStringAttribute({
                attributes: span.attributes,
                key: "url.path",
              }) ??
              "",
          ),
      );

      if (gatewaySpan !== undefined) {
        return {
          apiGatewayClientSpan,
          gatewaySpan,
        };
      }
    }

    await systemSleeper.sleep(TracePollingIntervalMs);
  }

  throw new Error(
    "Timed out waiting for runtime-state trace propagation across data-plane-api and data-plane-gateway.",
  );
}

describe("system runtime state tracing", () => {
  it("propagates one trace across data-plane-api and data-plane-gateway for runtime-state reads", async ({
    fixture,
  }) => {
    const organizationId = `org_${randomUUID().replaceAll("-", "")}`;
    const sandboxInstanceId = `sbi_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({
      connectionString: fixture.controlPlaneDatabaseUrl,
    });
    const dataPlaneDb = createDataPlaneDatabase(pool);

    try {
      await dataPlaneDb.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId,
        sandboxProfileId: `sbp_${randomUUID().replaceAll("-", "")}`,
        sandboxProfileVersion: 1,
        runtimeProvider: SandboxInstanceProviders.DOCKER,
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: SandboxInstanceStarterKinds.SYSTEM,
        startedById: "system-runtime-state-tracing",
        source: SandboxInstanceSources.DASHBOARD,
        title: "Tracing system test sandbox",
      });

      const baselineRequestCount = (
        await readCapturedOtlpRequests(fixture.otlpTraceCaptureFilePath)
      ).length;
      const response = await fetch(
        `${fixture.dataPlaneApiBaseUrl}/internal/sandbox/instances?organizationId=${encodeURIComponent(organizationId)}`,
        {
          headers: {
            [DataPlaneInternalAuthHeader]: fixture.internalAuthServiceToken,
          },
        },
      );

      expect(response.status).toBe(200);

      const { apiGatewayClientSpan, gatewaySpan } = await waitForSynchronousRuntimeStateTrace({
        baselineRequestCount,
        otlpTraceCaptureFilePath: fixture.otlpTraceCaptureFilePath,
      });

      expect(gatewaySpan.traceId).toBe(apiGatewayClientSpan.traceId);
      expect(gatewaySpan.spanId).not.toBe(apiGatewayClientSpan.spanId);
    } finally {
      await dataPlaneDb
        .delete(sandboxInstances)
        .where(
          and(
            eq(sandboxInstances.organizationId, organizationId),
            eq(sandboxInstances.id, sandboxInstanceId),
          ),
        );
      await pool.end();
    }
  }, 60_000);
});
