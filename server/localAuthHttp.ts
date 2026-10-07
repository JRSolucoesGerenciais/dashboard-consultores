import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createLocalUser, getUserByEmail, touchLastSignedIn } from "./db";
import { localOpenId, normalizeEmail } from "./_core/access";
import { getSessionCookieOptions } from "./_core/cookies";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./_core/password";
import { createSessionToken, SESSION_TTL_MS } from "./_core/session";

const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) });
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

// Limite simples em memória: 8 tentativas por IP+e-mail a cada 15 minutos.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}
function registerFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

// Hash fictício para que e-mail inexistente leve o mesmo tempo que senha errada.
const DUMMY_HASH = "scrypt$16384$8$1$00000000000000000000000000000000$" + "00".repeat(64);

export function registerLocalAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Informe e-mail e senha." });

    const email = normalizeEmail(parsed.data.email);
    const key = `${req.ip}|${email}`;
    if (tooManyAttempts(key)) {
      return void res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    }

    const user = await getUserByEmail(email);
    const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      registerFailure(key);
      return void res.status(401).json({ error: "E-mail ou senha inválidos." });
    }
    if (user.status === "pendente") {
      return void res.status(403).json({ error: "Cadastro aguardando liberação do administrador." });
    }
    if (user.status === "bloqueado") {
      return void res.status(403).json({ error: "Acesso bloqueado. Fale com o administrador." });
    }

    attempts.delete(key);
    await touchLastSignedIn(user.id);
    const token = await createSessionToken(user.openId);
    res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: SESSION_TTL_MS });
    res.json({ success: true });
  });

  // Autocadastro: sempre entra como cliente/pendente; só o administrador libera.
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: `Preencha nome, e-mail e senha (mínimo ${MIN_PASSWORD_LENGTH} caracteres).` });
    }
    const email = normalizeEmail(parsed.data.email);
    const key = `register|${req.ip}`;
    if (tooManyAttempts(key)) return void res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    registerFailure(key);

    if (await getUserByEmail(email)) {
      // Mesma resposta de sucesso evita enumerar e-mails já cadastrados.
      return void res.json({ success: true, message: "Cadastro recebido. Aguarde a liberação do administrador." });
    }
    await createLocalUser({
      openId: localOpenId(email),
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      role: "user",
      profileRole: "cliente",
      status: "pendente",
    });
    res.json({ success: true, message: "Cadastro recebido. Aguarde a liberação do administrador." });
  });
}
