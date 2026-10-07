import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { jwtVerify, SignJWT } from "jose";
import { ENV } from "./env";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 h

function secretKey() {
  if (ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET deve ter ao menos 32 caracteres.");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createSessionToken(openId: string): Promise<string> {
  return new SignJWT({ openId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + SESSION_TTL_MS) / 1000))
    .sign(secretKey());
}

export async function readSessionOpenId(req: Request): Promise<string | null> {
  const token = parseCookieHeader(req.headers.cookie ?? "")[COOKIE_NAME];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.openId === "string" && payload.openId ? payload.openId : null;
  } catch {
    return null;
  }
}
