// Shared augmentation so `req.userId` (set by requireAuth) type-checks
// anywhere a plain Express Request is used, not just AuthenticatedRequest.
import "express";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}
