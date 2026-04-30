export const AUTOMATION_SCHEDULES_ROUTE_BASE_PATH = "/v1/automations/schedules";

export const AutomationScheduleKinds = Object.freeze({
  SCHEDULE: "schedule",
});

export const AutomationSchedulesBadRequestCodes = Object.freeze({
  INVALID_SCHEDULE: "INVALID_SCHEDULE",
  INVALID_SANDBOX_PROFILE_REFERENCE: "INVALID_SANDBOX_PROFILE_REFERENCE",
  INVALID_SANDBOX_PROFILE_VERSION_REFERENCE: "INVALID_SANDBOX_PROFILE_VERSION_REFERENCE",
  INVALID_PRIMARY_REPOSITORY: "INVALID_PRIMARY_REPOSITORY",
});

export const ScheduleActionFailureCodes = Object.freeze({
  SCHEDULE_DELETED: "schedule_deleted",
  SCHEDULE_DISABLED: "schedule_disabled",
});
