/**
 * Account management (DECISIONS.md #17): changing the password and the email.
 * Both require the current password; wrong guesses are rate-limited; a wrong
 * password is a 403 (a 401 would log the mobile user out). Prisma is mocked;
 * bcrypt runs for real.
 */
import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";
import { authService, PASSWORD_CHECK_MAX_FAILURES } from "./auth.service";

const tx = {
  user: { update: jest.fn() },
  passwordResetCode: { deleteMany: jest.fn() },
};

jest.mock("../config/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    passwordResetCode: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  passwordResetCode: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

const CURRENT = "currentpass1";
let hash: string;
// the rate limiter keeps state across tests, so each test uses its own user id
let n = 0;
const newId = () => `user-${++n}`;

beforeAll(async () => {
  hash = await bcrypt.hash(CURRENT, 4);
});

beforeEach(() => {
  jest.resetAllMocks();
  db.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[])));
  db.user.update.mockResolvedValue({});
  db.passwordResetCode.deleteMany.mockResolvedValue({ count: 0 });
  tx.user.update.mockResolvedValue({ id: "x", email: "new@example.com", displayName: "Hao" });
  tx.passwordResetCode.deleteMany.mockResolvedValue({ count: 0 });
});

const user = (id: string, over: object = {}) => ({ id, email: "old@example.com", displayName: "Hao", passwordHash: hash, isSynthetic: false, ...over });

describe("changePassword", () => {
  it("sets the new password as a bcrypt hash and discards any outstanding reset code", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));

    await authService.changePassword(id, { currentPassword: CURRENT, newPassword: "brandnewpass1" });

    const data = db.user.update.mock.calls[0][0].data;
    expect(data.passwordHash).not.toBe("brandnewpass1");
    expect(await bcrypt.compare("brandnewpass1", data.passwordHash)).toBe(true);
    expect(db.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { userId: id } });
  });

  it("refuses a wrong current password with 403 (not 401, which would log the user out)", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));

    await expect(authService.changePassword(id, { currentPassword: "wrongwrong1", newPassword: "brandnewpass1" })).rejects.toMatchObject({
      statusCode: 403,
      message: "Current password is incorrect",
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses a new password identical to the current one", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));

    await expect(authService.changePassword(id, { currentPassword: CURRENT, newPassword: CURRENT })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("validates the new password length before touching the database", async () => {
    await expect(authService.changePassword(newId(), { currentPassword: CURRENT, newPassword: "short" })).rejects.toThrow();
    await expect(authService.changePassword(newId(), { currentPassword: "", newPassword: "longenough1" })).rejects.toThrow();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("401s if the account no longer exists, or is a synthetic user", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(authService.changePassword(newId(), { currentPassword: CURRENT, newPassword: "brandnewpass1" })).rejects.toMatchObject({ statusCode: 401 });
    db.user.findUnique.mockResolvedValue(user("s", { isSynthetic: true }));
    await expect(authService.changePassword(newId(), { currentPassword: CURRENT, newPassword: "brandnewpass1" })).rejects.toMatchObject({ statusCode: 401 });
  });

  describe("rate limiting wrong guesses", () => {
    it(`blocks after ${PASSWORD_CHECK_MAX_FAILURES} wrong guesses, even for the correct password, with a 429 that says how long`, async () => {
      const id = newId();
      db.user.findUnique.mockResolvedValue(user(id));

      for (let i = 0; i < PASSWORD_CHECK_MAX_FAILURES; i++) {
        await expect(authService.changePassword(id, { currentPassword: "wrongwrong1", newPassword: "brandnewpass1" })).rejects.toMatchObject({ statusCode: 403 });
      }
      await expect(authService.changePassword(id, { currentPassword: CURRENT, newPassword: "brandnewpass1" })).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringMatching(/Too many incorrect attempts.*minute/),
      });
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("counts per account: someone else is unaffected", async () => {
      const attacker = newId();
      const other = newId();
      db.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(user(where.id)));

      for (let i = 0; i < PASSWORD_CHECK_MAX_FAILURES; i++) {
        await authService.changePassword(attacker, { currentPassword: "wrongwrong1", newPassword: "brandnewpass1" }).catch(() => undefined);
      }
      await expect(authService.changePassword(other, { currentPassword: CURRENT, newPassword: "brandnewpass1" })).resolves.toBeUndefined();
    });

    it("a correct password resets the count", async () => {
      const id = newId();
      db.user.findUnique.mockResolvedValue(user(id));
      const wrong = () => authService.changePassword(id, { currentPassword: "wrongwrong1", newPassword: "brandnewpass1" }).catch((e) => e.statusCode);

      for (let i = 0; i < PASSWORD_CHECK_MAX_FAILURES - 1; i++) await wrong();
      await authService.changePassword(id, { currentPassword: CURRENT, newPassword: "brandnewpass1" }); // correct: resets
      for (let i = 0; i < PASSWORD_CHECK_MAX_FAILURES - 1; i++) expect(await wrong()).toBe(403); // not yet blocked
    });
  });
});

describe("changeEmail", () => {
  it("normalises the new address, updates it, discards a reset code addressed to the old one, and returns the user", async () => {
    const id = newId();
    db.user.findUnique.mockImplementation(({ where }: { where: { id?: string; email?: string } }) => Promise.resolve(where.id ? user(id) : null));

    const result = await authService.changeEmail(id, { newEmail: "  New@Example.COM ", password: CURRENT });

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id }, data: { email: "new@example.com" } });
    expect(tx.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { userId: id } });
    expect(result).toEqual({ id: "x", email: "new@example.com", displayName: "Hao" });
  });

  it("refuses a wrong password with 403, and does not even look up the new address (nothing to learn by guessing)", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));

    await expect(authService.changeEmail(id, { newEmail: "new@example.com", password: "wrongwrong1" })).rejects.toMatchObject({ statusCode: 403 });

    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an address that is already the user's own", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));
    await expect(authService.changeEmail(id, { newEmail: "OLD@example.com", password: CURRENT })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("409s for an address another account already uses", async () => {
    const id = newId();
    db.user.findUnique.mockImplementation(({ where }: { where: { id?: string; email?: string } }) =>
      Promise.resolve(where.id ? user(id) : { id: "someone-else", email: where.email })
    );

    await expect(authService.changeEmail(id, { newEmail: "taken@example.com", password: CURRENT })).rejects.toMatchObject({ statusCode: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("409s if someone registers the same address between the check and the update", async () => {
    const id = newId();
    db.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(where.id ? user(id) : null));
    db.$transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    await expect(authService.changeEmail(id, { newEmail: "race@example.com", password: CURRENT })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("validates the address before touching the database", async () => {
    await expect(authService.changeEmail(newId(), { newEmail: "not-an-email", password: CURRENT })).rejects.toThrow();
    await expect(authService.changeEmail(newId(), { newEmail: "a@b.com", password: "" })).rejects.toThrow();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("shares the wrong-password limit with changing the password", async () => {
    const id = newId();
    db.user.findUnique.mockResolvedValue(user(id));
    for (let i = 0; i < PASSWORD_CHECK_MAX_FAILURES; i++) {
      await authService.changePassword(id, { currentPassword: "wrongwrong1", newPassword: "brandnewpass1" }).catch(() => undefined);
    }
    await expect(authService.changeEmail(id, { newEmail: "new@example.com", password: CURRENT })).rejects.toMatchObject({ statusCode: 429 });
  });
});
