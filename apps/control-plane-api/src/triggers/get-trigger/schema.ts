import { NotFoundResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { TriggerListItemSchema } from "../schemas.js";

export const GetTriggerResponseSchema = TriggerListItemSchema;
export const GetTriggerBadRequestResponseSchema = ValidationErrorResponseSchema;
export const GetTriggerNotFoundResponseSchema = NotFoundResponseSchema;
