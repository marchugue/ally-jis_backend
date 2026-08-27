import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../types/auth.types';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);

  const status = err instanceof HttpError ? err.status : err?.status || 500;
  const message = status === 500 ? 'Internal server error' : err?.message || 'Something went wrong';

  res.status(status).json({ message });
};