import { NotFoundResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { TriggerActivityResponseSchema } from "../schemas.js";

export const ListTriggerActivityResponseSchema = TriggerActivityResponseSchema;
export const ListTriggerActivityBadRequestResponseSchema = ValidationErrorResponseSchema;
export const ListTriggerActivityNotFoundResponseSchema = NotFoundResponseSchema;
