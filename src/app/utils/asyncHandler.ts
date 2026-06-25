import type { NextFunction, Request, Response } from 'express';

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncFn) {
  return function (req: Request, res: Response, next: NextFunction): void {
    
    fn(req, res, next).catch(next);
  };
}