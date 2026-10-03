/**
 * Password reset (DECISIONS.md #10): emailed 6-digit code, 15-minute expiry,
 * 5 attempts, resend cooldown, no account enumeration. Prisma and the mailer
 * are mocked; bcrypt/HMAC run for real.
 */
import bcrypt from "bcrypt";
import { createHmac } from "crypto";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import {
  authService,
  RESET_CODE_TTL_MS,
  RESET_MAX_ATTEMPTS,
  RESET_RESEND_COOLDOWN_MS,
} from "./auth.service";
import { mailerService } from "./mailer.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetCode: { upsert: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("./mailer.service", () => ({ mailerService: { send: jest.fn() } }));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  passwordResetCode: { upsert: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
};
const mailer = mailerService as unknown as { send: jest.Mock };

const hash = (userId: string, code: string) =>
  createHmac("sha256", env.jwtSecret).update(`${userId}:${code}`).digest("hex");

const user = (over: object = {}) => ({
  id: "u1",
  email: "a@b.com",
  isSynthetic: false,
  passwordReset: null,
  ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  mailer.send.mockResolvedValue(undefined);
  db.passwordResetCode.deleteMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockResolvedValue([]);
});

describe("requestPasswordReset", () => {
  it("stores only a hash of the code and emails the code to the user", async () => {
    db.user.findUnique.mockResolvedValue(user());
    await authService.requestPasswordReset({ email: "A@B.com" });

    const { create } = db.passwordResetCode.upsert.mock.calls[0][0];
    const sent = mailer.send.mock.calls[0][0];
    const code = /code is (\d{6})/.exec(sent.text)![1];

    expect(sent.to).toBe("a@b.com");
    expect(create.codeHash).toBe(hash("u1", code));
    expect(JSON.stringify(create)).not.toContain(code);
    const ttl = create.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(RESET_CODE_TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(RESET_CODE_TTL_MS);
  });

  it("does nothing, and does not throw, for an unknown email", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(authService.requestPasswordReset({ email: "x@y.com" })).resolves.toBeUndefined();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(db.passwordResetCode.upsert).not.toHaveBeenCalled();
  });

  it("does nothing for a synthetic user", async () => {
    db.user.findUnique.mockResolvedValue(user({ isSynthetic: true }));
    await authService.requestPasswordReset({ email: "a@b.com" });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("does not resend inside the cooldown window", async () => {
    db.user.findUnique.mockResolvedValue(
      user({ passwordReset: { createdAt: new Date(Date.now() - RESET_RESEND_COOLDOWN_MS + 10_000) } })
    );
    await authService.requestPasswordReset({ email: "a@b.com" });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("replaces an older code once the cooldown has passed", async () => {
    db.user.findUnique.mockResolvedValue(
      user({ passwordReset: { createdAt: new Date(Date.now() - RESET_RESEND_COOLDOWN_MS - 1000) } })
    );
    await authService.requestPasswordReset({ email: "a@b.com" });
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it("succeeds even if the mail provider fails (no leak via errors)", async () => {
    db.user.findUnique.mockResolvedValue(user());
    mailer.send.mockRejectedValue(new Error("smtp down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(authService.requestPasswordReset({ email: "a@b.com" })).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    spy.mockRestore();
  });

  it("rejects a malformed email", async () => {
    await expect(authService.requestPasswordReset({ email: "nope" })).rejects.toThrow();
  });
});

describe("resetPassword", () => {
  const withCode = (code = "123456", over: object = {}) =>
    user({
      passwordReset: { codeHash: hash("u1", code), expiresAt: new Date(Date.now() + 60_000), attempts: 0, ...over },
    });

  it("sets the new bcrypt-hashed password and consumes the code", async () => {
    db.user.findUnique.mockResolvedValue(withCode());
    db.passwordResetCode.update.mockResolvedValue({ attempts: 1, codeHash: hash("u1", "123456") });

    await authService.resetPassword({ email: "a@b.com", code: "123456", password: "brandnewpass" });

    const updateArgs = db.user.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "u1" });
    expect(updateArgs.data.passwordHash).not.toBe("brandnewpass");
    expect(await bcrypt.compare("brandnewpass", updateArgs.data.passwordHash)).toBe(true);
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("rejects a wrong code with the generic 400 and leaves the password alone", async () => {
    db.user.findUnique.mockResolvedValue(withCode());
    db.passwordResetCode.update.mockResolvedValue({ attempts: 1, codeHash: hash("u1", "123456") });

    await expect(
      authService.resetPassword({ email: "a@b.com", code: "000000", password: "brandnewpass" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid or expired reset code" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.passwordResetCode.deleteMany).not.toHaveBeenCalled();
  });

  it("burns the code on the last allowed wrong attempt", async () => {
    db.user.findUnique.mockResolvedValue(withCode());
    db.passwordResetCode.update.mockResolvedValue({ attempts: RESET_MAX_ATTEMPTS, codeHash: hash("u1", "123456") });

    await expect(
      authService.resetPassword({ email: "a@b.com", code: "000000", password: "brandnewpass" })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("rejects even the CORRECT code once the attempt limit is exceeded", async () => {
    db.user.findUnique.mockResolvedValue(withCode());
    db.passwordResetCode.update.mockResolvedValue({ attempts: RESET_MAX_ATTEMPTS + 1, codeHash: hash("u1", "123456") });

    await expect(
      authService.resetPassword({ email: "a@b.com", code: "123456", password: "brandnewpass" })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an expired code and deletes it", async () => {
    db.user.findUnique.mockResolvedValue(withCode("123456", { expiresAt: new Date(Date.now() - 1000) }));

    await expect(
      authService.resetPassword({ email: "a@b.com", code: "123456", password: "brandnewpass" })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.passwordResetCode.deleteMany).toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown email", null],
    ["synthetic user", user({ isSynthetic: true })],
    ["no code outstanding", user()],
  ])("gives the same generic 400 for %s", async (_label, found) => {
    db.user.findUnique.mockResolvedValue(found);
    await expect(
      authService.resetPassword({ email: "a@b.com", code: "123456", password: "brandnewpass" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid or expired reset code" });
  });

  it("validates code format and password length before touching the database", async () => {
    await expect(authService.resetPassword({ email: "a@b.com", code: "12ab56", password: "brandnewpass" })).rejects.toThrow();
    await expect(authService.resetPassword({ email: "a@b.com", code: "123456", password: "short" })).rejects.toThrow();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
