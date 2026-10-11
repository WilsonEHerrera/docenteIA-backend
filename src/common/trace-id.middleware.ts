import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const TRACE_ID_HEADER = 'x-request-id';
const SAFE_TRACE_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface TracedRequest extends Request {
  traceId?: string;
}

export function traceIdMiddleware(
  req: TracedRequest,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(TRACE_ID_HEADER);
  const traceId =
    incoming && SAFE_TRACE_ID.test(incoming) ? incoming : randomUUID();
  req.traceId = traceId;
  res.setHeader(TRACE_ID_HEADER, traceId);
  next();
}
