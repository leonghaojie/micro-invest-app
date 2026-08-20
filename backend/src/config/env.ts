/**
 * Central place to read + validate process.env once at startup, instead of
 * scattering `process.env.X!` casts across services.
 */
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
  // SRS §2.5 / Design Model §5: locked Phase 1 decision.
  minGroupSize: Number(process.env.MIN_GROUP_SIZE ?? 10),
  // Optional — only prisma/ingest-funds.ts needs this, not the server.
  eodhdApiKey: process.env.EODHD_API_KEY,
};
