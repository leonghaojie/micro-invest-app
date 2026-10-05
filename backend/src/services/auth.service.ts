/**
 * AuthService — FR01 (register), FR02 (login), NFR-06 (bcrypt salted hash).
 */
import bcrypt from "bcrypt";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { createAttemptLimiter } from "../utils/attemptLimiter";
import { HttpError } from "../utils/httpError";
import { mailerService } from "./mailer.service";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // NFR-06 requires a salted hash, not a specific complexity policy — 8
  // chars is the floor bcrypt itself is comfortable hashing meaningfully.
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof credentialsSchema>;
export type LoginInput = z.infer<typeof credentialsSchema>;

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// DECISIONS.md #10 — password reset limits.
export const RESET_CODE_TTL_MS = 15 * 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;
export const RESET_RESEND_COOLDOWN_MS = 60 * 1000;

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your current password"),
});

// DECISIONS.md #17: proving you know the current password (to change the password or
// the email) allows 5 wrong guesses per 15 minutes per account, then blocks. Without
// this, a stolen session token could be used to guess the password without limit.
export const PASSWORD_CHECK_MAX_FAILURES = 5;
export const PASSWORD_CHECK_WINDOW_MS = 15 * 60 * 1000;
const passwordChecks = createAttemptLimiter({ maxFailures: PASSWORD_CHECK_MAX_FAILURES, windowMs: PASSWORD_CHECK_WINDOW_MS });

export interface AuthResult {
  token: string;
  user: { id: string; email: string };
}

// Generic on purpose (SRS NFR-04 "meaningful errors" is not the same as
// "leak which half of the credential pair was wrong").
const INVALID_CREDENTIALS = "Invalid email or password";

// One message for every way a reset can fail (no such account, no code
// outstanding, expired, too many attempts, wrong code) so a caller can't tell
// them apart.
const INVALID_RESET_CODE = "Invalid or expired reset code";

function hashResetCode(userId: string, code: string): string {
  return createHmac("sha256", env.jwtSecret).update(`${userId}:${code}`).digest("hex");
}

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

  /**
   * Confirms a token still belongs to a real account. requireAuth only
   * verifies the JWT's signature, so a token outlives its user (deleted
   * account, reset database); the mobile app calls this on launch to decide
   * whether to show the login screen.
   */
  async getCurrentUser(userId: string): Promise<{ id: string; email: string; displayName: string | null }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isSynthetic) {
      throw new HttpError(401, "Account no longer exists");
    }
    return { id: user.id, email: user.email, displayName: user.displayName };
  }

  /**
   * Loads the signed-in user and checks the password they typed against their
   * current one. A wrong password is a 403, deliberately NOT a 401: the mobile app
   * treats any authenticated 401 as "your session is dead" and logs the user out,
   * and a typo here must not do that.
   */
  private async requireCurrentPassword(userId: string, password: string) {
    const blocked = passwordChecks.blockedForMs(userId);
    if (blocked > 0) {
      throw new HttpError(429, `Too many incorrect attempts. Try again in ${Math.ceil(blocked / 60_000)} minute(s).`);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isSynthetic) {
      throw new HttpError(401, "Account no longer exists");
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      passwordChecks.recordFailure(userId);
      throw new HttpError(403, "Current password is incorrect");
    }
    passwordChecks.reset(userId);
    return user;
  }

  /** Sets a new password. Needs the current one. Other devices stay signed in:
   * sessions are stateless tokens (see DECISIONS.md #10 and #17). */
  async changePassword(userId: string, input: unknown): Promise<void> {
    const { currentPassword, newPassword } = changePasswordSchema.parse(input);
    const user = await this.requireCurrentPassword(userId, currentPassword);

    if (newPassword === currentPassword) {
      throw new HttpError(400, "Your new password must be different from the current one");
    }

    const passwordHash = await bcrypt.hash(newPassword, env.bcryptSaltRounds);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // a reset code issued before this change must not outlive it
      prisma.passwordResetCode.deleteMany({ where: { userId: user.id } }),
    ]);
  }

  /** Changes the sign-in email. Needs the current password. The new address is not
   * verified by email (DECISIONS.md #17), so a typo would make password reset
   * unreachable: the screen asks the user to double-check it. */
  async changeEmail(userId: string, input: unknown): Promise<{ id: string; email: string; displayName: string | null }> {
    const { newEmail, password } = changeEmailSchema.parse(input);
    const user = await this.requireCurrentPassword(userId, password);

    if (newEmail === user.email) {
      throw new HttpError(400, "That is already your email address");
    }
    const taken = await prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) {
      throw new HttpError(409, "That email is already registered");
    }

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({ where: { id: user.id }, data: { email: newEmail } });
        // a reset code was addressed to the old email
        await tx.passwordResetCode.deleteMany({ where: { userId: user.id } });
        return u;
      });
    } catch (err) {
      // lost a race with someone registering the same address
      if (isUniqueConstraintError(err)) throw new HttpError(409, "That email is already registered");
      throw err;
    }
    return { id: updated.id, email: updated.email, displayName: updated.displayName };
  }

  /**
   * Emails a one-time 6-digit code. Always resolves the same way whether or
   * not the email belongs to an account (no account enumeration), and never
   * waits on the mail provider, so response time doesn't give it away either.
   */
  async requestPasswordReset(input: { email: string }): Promise<void> {
    const { email } = forgotPasswordSchema.parse(input);

    const user = await prisma.user.findUnique({ where: { email }, include: { passwordReset: true } });
    if (!user || user.isSynthetic) return;

    // Cooldown: stops the endpoint being used to spam someone's inbox.
    const existing = user.passwordReset;
    if (existing && Date.now() - existing.createdAt.getTime() < RESET_RESEND_COOLDOWN_MS) return;

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const data = {
      codeHash: hashResetCode(user.id, code),
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      attempts: 0,
      createdAt: new Date(),
    };
    await prisma.passwordResetCode.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });

    void mailerService
      .send({
        to: user.email,
        subject: "Your Micro-Invest password reset code",
        text:
          `Your password reset code is ${code}.\n\n` +
          `It expires in ${RESET_CODE_TTL_MS / 60000} minutes. If you didn't ask to reset your password, ` +
          `you can ignore this email — your password has not changed.`,
      })
      .catch((err) => console.error("[auth] failed to send password reset email:", err));
  }

  /** Verifies the code and sets a new password. Does not log the user in. */
  async resetPassword(input: { email: string; code: string; password: string }): Promise<void> {
    const { email, code, password } = resetPasswordSchema.parse(input);

    const user = await prisma.user.findUnique({ where: { email }, include: { passwordReset: true } });
    if (!user || user.isSynthetic || !user.passwordReset) {
      throw new HttpError(400, INVALID_RESET_CODE);
    }

    if (user.passwordReset.expiresAt.getTime() < Date.now()) {
      await prisma.passwordResetCode.deleteMany({ where: { userId: user.id } });
      throw new HttpError(400, INVALID_RESET_CODE);
    }

    // Count the attempt *before* comparing, atomically, so concurrent guesses
    // can't slip past the limit.
    const { attempts, codeHash } = await prisma.passwordResetCode.update({
      where: { userId: user.id },
      data: { attempts: { increment: 1 } },
    });
    if (attempts > RESET_MAX_ATTEMPTS) {
      await prisma.passwordResetCode.deleteMany({ where: { userId: user.id } });
      throw new HttpError(400, INVALID_RESET_CODE);
    }

    const expected = Buffer.from(codeHash, "hex");
    const actual = Buffer.from(hashResetCode(user.id, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      if (attempts >= RESET_MAX_ATTEMPTS) {
        await prisma.passwordResetCode.deleteMany({ where: { userId: user.id } });
      }
      throw new HttpError(400, INVALID_RESET_CODE);
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordResetCode.deleteMany({ where: { userId: user.id } }),
    ]);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

export const authService = new AuthService();
