import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so that an error it throws (a database failure, say) reaches
 * the error handler in index.ts. Express 4 does not watch the promise itself: without this
 * the request would hang and the error would go unhandled.
 */
export function handle<R extends Request>(
  fn: (req: R, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as R, res, next).catch(next);
  };
}
