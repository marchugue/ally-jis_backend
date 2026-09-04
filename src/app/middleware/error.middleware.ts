import type { ErrorRequestHandler } from 'express';
import { HttpError } from '../types/auth.types';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);

  const status = err instanceof HttpError ? err.status : err?.status || 500;
  const message = status === 500 ? 'Internal server error' : err?.message || 'Something went wrong';

  // For OTP-required login failures, forward the extra fields so the client
  // can route the user to the OTP verification screen.
  const body: Record<string, unknown> = { message };
  if (err?.requiresOtp) {
    body.requiresOtp = true;
    body.userId = err.userId;
    body.email = err.email;
  }

  res.status(status).json(body);
};