/**
 * AuthService — FR01 (register), FR02 (login), NFR-06 (bcrypt salted hash).
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { HttpError } from "../utils/httpError";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // NFR-06 requires a salted hash, not a specific complexity policy — 8
  // chars is the floor bcrypt itself is comfortable hashing meaningfully.
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof credentialsSchema>;
export type LoginInput = z.infer<typeof credentialsSchema>;

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
}

// Generic on purpose (SRS NFR-04 "meaningful errors" is not the same as
// "leak which half of the credential pair was wrong").
const INVALID_CREDENTIALS = "Invalid email or password";

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

class AuthService {
  async register(input: RegisterInput): Promise<AuthResult> {
    const { email, password } = credentialsSchema.parse(input);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "Email already registered");
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

    let user;
    try {
      user = await prisma.user.create({ data: { email, passwordHash } });
    } catch (err) {
      // Race with another concurrent registration for the same email —
      // the findUnique check above narrows the window but doesn't close it.
      if (isUniqueConstraintError(err)) {
        throw new HttpError(409, "Email already registered");
      }
      throw err;
    }

    return { token: signToken(user.id), user: { id: user.id, email: user.email } };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const { email, password } = credentialsSchema.parse(input);

    const user = await prisma.user.findUnique({ where: { email } });
    // Synthetic (seeded peer) users are excluded from authentication
    // entirely (DECISIONS.md #4 / SRS §4 Data Dictionary) — treated the
    // same as "no such user" so the response gives nothing away.
    if (!user || user.isSynthetic) {
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    return { token: signToken(user.id), user: { id: user.id, email: user.email } };
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export const authService = new AuthService();
