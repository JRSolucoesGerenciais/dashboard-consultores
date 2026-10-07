import type { NextFunction, Request, Response } from "express";
import { getUserByOpenId } from "../db";
import { readSessionOpenId } from "./session";

async function activeUser(req: Request) {
  const openId = await readSessionOpenId(req);
  const user = openId ? await getUserByOpenId(openId) : undefined;
  return user && user.status === "ativo" ? user : null;
}

/** Rotas HTTP fora do tRPC: exige sessão de administrador. */
export async function requireAdminHttp(req: Request, res: Response, next: NextFunction) {
  const user = await activeUser(req).catch(() => null);
  if (!user) return void res.status(401).json({ message: "Faça login para continuar." });
  if (user.role !== "admin") return void res.status(403).json({ message: "Apenas administradores podem executar esta ação." });
  next();
}

/** Rotas HTTP fora do tRPC: exige qualquer usuário ativo. */
export async function requireUserHttp(req: Request, res: Response, next: NextFunction) {
  const user = await activeUser(req).catch(() => null);
  if (!user) return void res.status(401).json({ message: "Faça login para continuar." });
  next();
}
