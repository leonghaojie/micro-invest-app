/**
 * Typed error for controllers/services to throw when they know the exact
 * HTTP status a failure should map to (e.g. 409 on duplicate email, 401 on
 * bad credentials). Caught centrally by errorHandler.middleware.ts, same
 * place ZodError is caught, so controllers stay thin (Design Model §3.1)
 * and never write res.status(...) for the error path themselves.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}
