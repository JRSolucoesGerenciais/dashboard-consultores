import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId } from "../db";
import { readSessionOpenId } from "./session";

/** Usuário sem dados sensíveis: o hash da senha nunca sai do servidor. */
export type SafeUser = Omit<User, "passwordHash">;

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SafeUser | null;
};

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: SafeUser | null = null;

  try {
    const openId = await readSessionOpenId(opts.req);
    const found = openId ? await getUserByOpenId(openId) : undefined;
    // Bloqueio/pendência valem imediatamente, mesmo com cookie ainda válido.
    user = found && found.status === "ativo" ? toSafeUser(found) : null;
  } catch {
    user = null;
  }

  return { req: opts.req, res: opts.res, user };
}
