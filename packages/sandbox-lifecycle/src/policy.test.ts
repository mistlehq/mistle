import { describe, expect, it } from "vitest";

import {
  getSandboxDeliveryDisposition,
  getSandboxEffectiveStatus,
  isSandboxBootstrapTokenExchangeEligible,
  isSandboxDisconnectReconciliationCandidate,
  isSandboxUserStopEligible,
  SandboxDeliveryDispositions,
  SandboxInstanceStatuses,
} from "./index.js";

describe("getSandboxDeliveryDisposition", () => {
  it("classifies only running as immediately deliverable", () => {
    expect(getSandboxDeliveryDisposition(SandboxInstanceStatuses.RUNNING)).toBe(
      SandboxDeliveryDispositions.DELIVER,
    );
    expect(getSandboxDeliveryDisposition(SandboxInstanceStatuses.RECONNECTING)).toBe(
      SandboxDeliveryDispositions.WAIT,
    );
    expect(getSandboxDeliveryDisposition(SandboxInstanceStatuses.STOPPED)).toBe(
      SandboxDeliveryDispositions.RESUME,
    );
    expect(getSandboxDeliveryDisposition(SandboxInstanceStatuses.FAILED)).toBe(
      SandboxDeliveryDispositions.RECOVER,
    );
    expect(getSandboxDeliveryDisposition(SandboxInstanceStatuses.STOPPING)).toBe(
      SandboxDeliveryDispositions.NON_DELIVERABLE,
    );
  });
});

describe("status policy helpers", () => {
  it("allows bootstrap token exchange while provider or runtime startup can still attach", () => {
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.STARTING)).toBe(true);
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.STARTED)).toBe(true);
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.INITIALIZING)).toBe(
      true,
    );
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.RUNNING)).toBe(true);
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.RECONNECTING)).toBe(
      true,
    );
    expect(isSandboxBootstrapTokenExchangeEligible(SandboxInstanceStatuses.STOPPED)).toBe(false);
  });

  it("allows user stops for running and reconnecting sandboxes only", () => {
    expect(isSandboxUserStopEligible(SandboxInstanceStatuses.RUNNING)).toBe(true);
    expect(isSandboxUserStopEligible(SandboxInstanceStatuses.RECONNECTING)).toBe(true);
    expect(isSandboxUserStopEligible(SandboxInstanceStatuses.INITIALIZING)).toBe(false);
    expect(isSandboxUserStopEligible(SandboxInstanceStatuses.STOPPED)).toBe(false);
  });

  it("marks active lifecycle states as disconnect reconciliation candidates", () => {
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.STARTING)).toBe(true);
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.STARTED)).toBe(true);
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.INITIALIZING)).toBe(
      true,
    );
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.RUNNING)).toBe(true);
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.RECONNECTING)).toBe(
      true,
    );
    expect(isSandboxDisconnectReconciliationCandidate(SandboxInstanceStatuses.PENDING)).toBe(false);
  });
});

describe("getSandboxEffectiveStatus", () => {
  it("keeps durable terminal and reconnecting states authoritative", () => {
    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.FAILED,
        runtimeReady: true,
        bootstrapAttached: true,
      }),
    ).toBe(SandboxInstanceStatuses.FAILED);

    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.RECONNECTING,
        runtimeReady: true,
        bootstrapAttached: true,
      }),
    ).toBe(SandboxInstanceStatuses.RECONNECTING);
  });

  it("treats detached running sandboxes without runtime readiness as reconnecting", () => {
    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.RUNNING,
        runtimeReady: false,
        bootstrapAttached: false,
      }),
    ).toBe(SandboxInstanceStatuses.RECONNECTING);
  });

  it("treats attached running sandboxes without runtime readiness as initializing", () => {
    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.RUNNING,
        runtimeReady: false,
        bootstrapAttached: true,
      }),
    ).toBe(SandboxInstanceStatuses.INITIALIZING);
  });

  it("requires runtime readiness before effective running", () => {
    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.INITIALIZING,
        runtimeReady: true,
        bootstrapAttached: true,
      }),
    ).toBe(SandboxInstanceStatuses.RUNNING);
  });

  it("keeps stopped without live runtime stopped", () => {
    expect(
      getSandboxEffectiveStatus({
        persistedStatus: SandboxInstanceStatuses.STOPPED,
        runtimeReady: false,
        bootstrapAttached: false,
      }),
    ).toBe(SandboxInstanceStatuses.STOPPED);
  });
});
