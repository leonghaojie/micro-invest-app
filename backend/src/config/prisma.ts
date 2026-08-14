/**
 * PrismaClient singleton (Design Model §3.1 — "Repository pattern").
 *
 * Instantiated once here and imported wherever needed, rather than each
 * service creating its own connection. Every controller/service accesses
 * persistent data through this instance (or, for PeerBenchmarkService only,
 * via prisma.$queryRaw — see peerBenchmark.service.ts and Design Model §5.3).
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

// Reuse the client across hot-reloads in dev (tsx watch) to avoid exhausting
// the Postgres connection pool.
export const prisma = global.__prisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}

export default prisma;
