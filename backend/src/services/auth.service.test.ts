/**
 * AuthService unit tests — FR01 (register), FR02 (login). Prisma is mocked
 * so these run without a live Postgres connection; bcrypt/jwt run for real
 * since they're pure and fast enough at test scale.
 */
import { prisma } from "../config/prisma";
import { authService } from "./auth.service";

jest.mock("../config/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; create: jest.Mock };
};

describe("AuthService", () => {
  describe("register", () => {
    it("creates a user and returns a token when the email is free", async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);
      mockedPrisma.user.create.mockResolvedValue({
        id: "user-1",
        email: "new@example.com",
        passwordHash: "hashed",
        isSynthetic: false,
        createdAt: new Date(),
      });

      const result = await authService.register({ email: "New@Example.com", password: "correcthorse" });

      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "new@example.com" } });
      expect(mockedPrisma.user.create).toHaveBeenCalled();
      const createArgs = mockedPrisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe("new@example.com");
      expect(createArgs.data.passwordHash).not.toBe("correcthorse"); // never stores plaintext
      expect(result.user).toEqual({ id: "user-1", email: "new@example.com" });
      expect(typeof result.token).toBe("string");
    });

    it("rejects a duplicate email with 409", async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: "existing", email: "taken@example.com" });

      await expect(authService.register({ email: "taken@example.com", password: "correcthorse" })).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });

    it("rejects a short password with a validation error", async () => {
      await expect(authService.register({ email: "a@b.com", password: "short" })).rejects.toThrow();
      expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("returns a token for correct credentials", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("correcthorse", 4);
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        passwordHash,
        isSynthetic: false,
      });

      const result = await authService.login({ email: "user@example.com", password: "correcthorse" });

      expect(result.user).toEqual({ id: "user-1", email: "user@example.com" });
      expect(typeof result.token).toBe("string");
    });

    it("rejects an unknown email with a generic 401", async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);

      await expect(authService.login({ email: "nobody@example.com", password: "correcthorse" })).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid email or password",
      });
    });

    it("rejects a wrong password with the same generic 401", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("correcthorse", 4);
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        passwordHash,
        isSynthetic: false,
      });

      await expect(authService.login({ email: "user@example.com", password: "wrong-password" })).rejects.toMatchObject({
        statusCode: 401,
        message: "Invalid email or password",
      });
    });

    it("rejects synthetic peer users, which cannot authenticate (DECISIONS.md #4)", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("correcthorse", 4);
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: "synthetic-1",
        email: "synthetic@example.com",
        passwordHash,
        isSynthetic: true,
      });

      await expect(authService.login({ email: "synthetic@example.com", password: "correcthorse" })).rejects.toMatchObject({
        statusCode: 401,
      });
    });
  });
});
