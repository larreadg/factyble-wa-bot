import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export const asyncHandler =
  <Req extends Request = Request>(handler: AsyncRouteHandler<Req>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req as Req, res, next).catch(next);
  };
