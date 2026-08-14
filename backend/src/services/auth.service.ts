/**
 * AuthService — FR01 (register), FR02 (login), NFR-06 (bcrypt salted hash).
 * Implementation lands in Phase 3 (roadmap.md). Deliberately unimplemented
 * here: this is the Phase 2 (Design) skeleton, not the Phase 3 build.
 */
import { prisma } from "../config/prisma";

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

class AuthService {
  async register(_input: RegisterInput): Promise<{ implemented: false }> {
    void prisma; // wired for Phase 3 — bcrypt hash + prisma.user.create
    return { implemented: false };
  }

  async login(_input: LoginInput): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const authService = new AuthService();
