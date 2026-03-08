import argon2 from "argon2";
import { prisma } from "../../lib/prisma";
import { config } from "../../config/env";

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new Error("EMAIL_TAKEN");
    }

    const password_hash = await argon2.hash(input.password);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password_hash,
        role: "user",
        free_units_remaining: config.DEFAULT_FREE_UNITS,
        wallet: { create: { balance_inr_cents: 0 } },
      },
      select: {
        id: true,
        email: true,
        role: true,
        free_units_remaining: true,
        createdAt: true,
        wallet: { select: { balance_inr_cents: true } },
      },
    });

    return user;
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const valid = await argon2.verify(user.password_hash, input.password);
    if (!valid) {
      throw new Error("INVALID_CREDENTIALS");
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        free_units_remaining: true,
        createdAt: true,
        wallet: { select: { balance_inr_cents: true } },
      },
    });
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  }
}

export const authService = new AuthService();
