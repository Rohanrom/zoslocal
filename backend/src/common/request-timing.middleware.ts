import type { NextFunction, Request, Response } from 'express';

/**
 * Measures every request and reports it two ways:
 *
 * 1. A `Server-Timing: app;dur=<ms>` response header. Chrome DevTools shows it
 *    in Network → (request) → Timing, so you can tell server time apart from
 *    network and cold-start time.
 * 2. A log line for any request slower than SLOW_REQUEST_MS (default 800 ms),
 *    so slow endpoints show up in the Render logs without extra tooling.
 *
 * It only reads timings; it never changes the request or the response body.
 */
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 800);

export function requestTimingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = () =>
    Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  const originalWriteHead = res.writeHead.bind(res) as (
    ...args: unknown[]
  ) => Response;

  // Headers must be set before they are flushed, so add Server-Timing at the
  // last moment the status line is written.
  res.writeHead = ((...args: unknown[]) => {
    if (!res.headersSent) {
      res.setHeader('Server-Timing', `app;dur=${elapsedMs().toFixed(1)}`);
      res.setHeader('Timing-Allow-Origin', '*');
    }
    return originalWriteHead(...args);
  }) as Response['writeHead'];

  res.on('finish', () => {
    const ms = elapsedMs();
    if (ms >= SLOW_REQUEST_MS) {
      // originalUrl keeps the query string, which identifies the project.
      console.warn(
        `[slow] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`,
      );
    }
  });

  next();
}
