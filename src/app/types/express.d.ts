// src/types/express.d.ts
//
// Augments Express's Request type so req.userId / req.accessToken
// (set by auth.middleware.ts) are recognized everywhere without `any`.

import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      accessToken?: string;
    }
  }
}

export {};