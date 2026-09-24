// Failures, in the shapes the hosted API uses.
//
// A drop-in has to fail the same way it succeeds, because a client's error
// handling is code too. The hosted API puts everything under `detail`, in one
// of three shapes, and the status code says which to expect:
//
//   422  a list of field problems, the way a schema validator reports them
//   400  a usage problem: either a plain sentence, or { error_type, message }
//   401  a bad key, as { error_type, message }
//   403  no key at all, the same
//
// `VejError` carries the whole body so the server does not have to know any
// of this.

export class VejError extends Error {
  constructor(message, { status = 500, detail = null, cause } = {}) {
    super(message, { cause });
    this.name = "VejError";
    this.status = status;
    this.detail = detail ?? message;
  }
}

/** 422: a field is missing or the wrong shape. `detail` is a list, as a schema validator sends. */
export class ValidationError extends VejError {
  /**
   * @param {object[]} problems Entries of `{ type, loc, msg, input }`.
   * @param {string} [summary] What to say in a thrown-error message.
   */
  constructor(problems, summary = "Request validation failed.") {
    super(summary, { status: 422, detail: problems });
    this.name = "ValidationError";
  }
}

/**
 * 400: the request parsed but asks for something the API will not do.
 *
 * Jev phrases these two ways and Vej matches both: a bare sentence for a limit
 * ("Too many score levels…") and an object for a category of mistake.
 */
export class UsageError extends VejError {
  constructor(message, { type = null } = {}) {
    super(message, { status: 400, detail: type ? { error_type: type, message } : message });
    this.name = "UsageError";
  }
}

/** 401 for a key that is wrong, 403 for no key at all — which is what Jev does. */
export class AuthError extends VejError {
  constructor(message, status) {
    super(message, { status, detail: { error_type: "authentication_error", message } });
    this.name = "AuthError";
  }
}

/** The runtime could not load or run a model. */
export class RuntimeError extends VejError {
  constructor(message, options) {
    super(message, { status: 500, ...options });
    this.name = "RuntimeError";
  }
}

/**
 * Kept for callers that catch it by name. Everything it reported is now either
 * a `ValidationError` or a `UsageError`, so it stays a base for both.
 */
export class InvalidRequestError extends VejError {
  constructor(message, status = 422) {
    super(message, { status });
    this.name = "InvalidRequestError";
  }
}
