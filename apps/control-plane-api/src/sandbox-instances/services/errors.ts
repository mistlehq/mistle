import { BadRequestError, ConflictError, NotFoundError } from "@mistle/http/errors.js";

import {
  SandboxInstancesBadRequestCodes,
  SandboxInstancesConflictCodes,
  SandboxInstancesNotFoundCodes,
} from "../constants.js";

export {
  SandboxInstancesBadRequestCodes,
  SandboxInstancesConflictCodes,
  SandboxInstancesNotFoundCodes,
};

export type SandboxInstancesNotFoundCode =
  (typeof SandboxInstancesNotFoundCodes)[keyof typeof SandboxInstancesNotFoundCodes];

export class SandboxInstancesNotFoundError extends NotFoundError {
  code: SandboxInstancesNotFoundCode;

  constructor(code: SandboxInstancesNotFoundCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export type SandboxInstancesBadRequestCode =
  (typeof SandboxInstancesBadRequestCodes)[keyof typeof SandboxInstancesBadRequestCodes];

export class SandboxInstancesBadRequestError extends BadRequestError {
  code: SandboxInstancesBadRequestCode;

  constructor(code: SandboxInstancesBadRequestCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export type SandboxInstancesConflictCode =
  (typeof SandboxInstancesConflictCodes)[keyof typeof SandboxInstancesConflictCodes];

export class SandboxInstancesConflictError extends ConflictError {
  code: SandboxInstancesConflictCode;

  constructor(code: SandboxInstancesConflictCode, message: string) {
    super(code, message);
    this.code = code;
  }
}
