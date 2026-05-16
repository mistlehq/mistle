import { NotFoundResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { AutomationListItemSchema } from "../schemas.js";

export const GetAutomationResponseSchema = AutomationListItemSchema;
export const GetAutomationBadRequestResponseSchema = ValidationErrorResponseSchema;
export const GetAutomationNotFoundResponseSchema = NotFoundResponseSchema;
