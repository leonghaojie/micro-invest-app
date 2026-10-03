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
  nodeEnv: process.env.NODE_ENV ?? "development",
  // DECISIONS.md #10: Gmail SMTP for password-reset emails. All optional —
  // without SMTP_USER/SMTP_PASS the mailer logs the message to the server
  // console instead (development only), so the flow works with no account.
  smtpHost: process.env.SMTP_HOST ?? "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT ?? 465),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  mailFrom: process.env.MAIL_FROM,
  // Optional — only prisma/ingest-funds.ts needs this, not the server.
  eodhdApiKey: process.env.EODHD_API_KEY,
};
