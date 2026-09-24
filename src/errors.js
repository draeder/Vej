/** Base class for every error Vej raises. */
export class VejError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "VejError";
  }
}

/**
 * A malformed request: bad question shape, unusable criteria, missing state.
 *
 * `status` is the HTTP code the server reports, chosen to match what the
 * TypeSafe API returns for the same mistake so a client's error handling does
 * not have to change when it is pointed at Vej.
 */
export class InvalidRequestError extends VejError {
  constructor(message, status = 422) {
    super(message);
    this.name = "InvalidRequestError";
    this.status = status;
  }
}

/** The runtime could not load or run the model. */
export class RuntimeError extends VejError {
  constructor(message, options) {
    super(message, options);
    this.name = "RuntimeError";
    this.status = 500;
  }
}
