import express from "express";
import http from "http";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projects } from "../drizzle/schema";
import { localOpenId } from "./_core/access";
import { toSafeUser, type TrpcContext } from "./_core/context";
import { hashPassword } from "./_core/password";
import { captureDailySnapshot, getDailyComparison, getProjectDailyTrend } from "./dailySnapshot";
import { createLocalUser, getDb, getUserByEmail, getUserProjectIds, listUsersWithAccess, setUserProjectIds, updateUserAdmin } from "./db";
import { registerLocalAuthRoutes } from "./localAuthHttp";
import { appRouter } from "./routers";

const PASSWORD = "senha-segura-123";

async function makeUser(email: string, over: Partial<Parameters<typeof createLocalUser>[0]> = {}) {
  const user = await createLocalUser({
    openId: localOpenId(email), email, name: email.split("@")[0],
    passwordHash: await hashPassword(PASSWORD), status: "ativo", ...over,
  });
  return user!;
}

const ctxOf = (user: Awaited<ReturnType<typeof makeUser>>): TrpcContext => ({
  user: toSafeUser(user),
  req: { protocol: "https", headers: {} } as any,
  res: { clearCookie: () => {} } as any,
});

async function makeProject(code: string, over: Record<string, unknown> = {}) {
  const db = (await getDb())!;
  const [row] = await db.insert(projects).values({
    code, name: `Projeto ${code}`, client: `Cliente ${code}`, managerName: "Gerente",
    startDate: "2026-01-01", plannedEndDate: "2026-12-31", projectedEndDate: "2026-12-31",
    plannedHours: "100.00", actualHours: "40.00", ...over,
  }).returning({ id: projects.id });
  return row.id;
}

describe("usuários, perfis e escopo (Postgres)", () => {
  it("coordenador só enxerga e altera os projetos liberados", async () => {
    const [a, b] = [await makeProject("P-A"), await makeProject("P-B")];
    const coord = await makeUser("coord@teste.com", { profileRole: "coordenador" });
    await setUserProjectIds(coord.id, [a]);
    expect(await getUserProjectIds(coord.id)).toEqual([a]);

    const caller = appRouter.createCaller(ctxOf(coord));
    expect((await caller.projects.list()).map((p) => p.id)).toEqual([a]);
    await expect(caller.projects.getById({ id: b })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.projects.addRisk({
      projectId: b, title: "x", category: "x", severity: "baixo", probability: "baixo", impact: "x", mitigationPlan: "x", owner: "x",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller.projects.addRisk({
      projectId: a, title: "Risco", category: "Prazo", severity: "alto", probability: "medio", impact: "x", mitigationPlan: "x", owner: "x",
    });
    const metrics = await caller.projects.getPortfolioMetrics();
    expect(metrics.totalProjects).toBe(1);
    expect(metrics.totalOpenRisks).toBe(1);
  });

  it("cliente lê o que foi liberado, mas não escreve", async () => {
    const id = await makeProject("P-C");
    const client = await makeUser("cliente@teste.com", { profileRole: "cliente" });
    await setUserProjectIds(client.id, [id]);
    const caller = appRouter.createCaller(ctxOf(client));
    expect((await caller.projects.getById({ id })).project.code).toBe("P-C");
    await expect(caller.projects.updateRiskStatus({ riskId: 1, status: "resolvido" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("administrador gerencia usuários e nunca fica sem administrador ativo", async () => {
    const admin = await makeUser("admin@teste.com", { role: "admin", profileRole: "coordenador" });
    const caller = appRouter.createCaller(ctxOf(admin));

    await caller.admin.createUser({ name: "Novo", email: "Novo@Teste.com", password: PASSWORD, profileRole: "cliente", projectIds: [] });
    const created = await getUserByEmail("novo@teste.com");
    expect(created).toMatchObject({ status: "ativo", profileRole: "cliente", role: "user" });
    await expect(caller.admin.createUser({ name: "Dup", email: "novo@teste.com", password: PASSWORD })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.admin.setUserProjects({ userId: created!.id, projectIds: [999999] })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const listed = await caller.admin.listUsers();
    expect(listed.every((u) => !("passwordHash" in u))).toBe(true);

    // Único administrador ativo não pode rebaixar nem bloquear a si mesmo.
    for (const other of (await listUsersWithAccess()).filter((u) => u.role === "admin" && u.id !== admin.id)) {
      await updateUserAdmin(other.id, { role: "user" });
    }
    await expect(caller.admin.updateUser({ id: admin.id, role: "user" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.admin.updateUser({ id: admin.id, status: "bloqueado" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("login por e-mail e senha (HTTP + Postgres)", () => {
  it("cadastro entra pendente, só loga depois de liberado e erra com senha inválida", async () => {
    const app = express();
    app.use(express.json());
    registerLocalAuthRoutes(app);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    try {
      expect((await post("/api/auth/register", { name: "Maria Silva", email: "Maria@Empresa.com", password: PASSWORD })).status).toBe(200);
      const pending = await getUserByEmail("maria@empresa.com");
      expect(pending).toMatchObject({ status: "pendente", role: "user", profileRole: "cliente" });

      expect((await post("/api/auth/login", { email: "maria@empresa.com", password: PASSWORD })).status).toBe(403);
      await updateUserAdmin(pending!.id, { status: "ativo" });

      expect((await post("/api/auth/login", { email: "maria@empresa.com", password: "senha-errada-123" })).status).toBe(401);
      expect((await post("/api/auth/login", { email: "ninguem@empresa.com", password: PASSWORD })).status).toBe(401);
      const ok = await post("/api/auth/login", { email: "MARIA@empresa.com", password: PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("set-cookie")).toContain("app_session_id=");
      expect(ok.headers.get("set-cookie")).toContain("HttpOnly");

      // Cadastro repetido não revela que o e-mail já existe.
      expect((await post("/api/auth/register", { name: "Maria Silva", email: "maria@empresa.com", password: PASSWORD })).status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("foto diária e comparação dia a dia (Postgres)", () => {
  it("grava a foto, é idempotente no dia e calcula as horas apontadas", async () => {
    const id = await makeProject("DIA-1", { actualHours: "40.00", completionPct: "40.00" });
    const db = (await getDb())!;

    const first = await captureDailySnapshot({ date: "2026-10-05" });
    expect(first.projects).toBeGreaterThan(0);
    await captureDailySnapshot({ date: "2026-10-05" }); // idempotente

    await db.update(projects).set({ actualHours: "46.25", completionPct: "46.25" }).where(eq(projects.id, id));
    await captureDailySnapshot({ date: "2026-10-06" });

    const cmp = await getDailyComparison({ projectIds: null });
    expect(cmp.toDate).toBe("2026-10-06");
    expect(cmp.fromDate).toBe("2026-10-05");
    expect(cmp.projects.find((p) => p.projectId === id)).toMatchObject({ kind: "alterado", actualDelta: 6.25 });

    const scoped = await getDailyComparison({ projectIds: [] });
    expect(scoped.projects).toEqual([]);

    const trend = await getProjectDailyTrend(id, 30);
    expect(trend).toEqual([expect.objectContaining({ date: "2026-10-06", actualDelta: 6.25 })]);
  });

  it("coordenador só vê a comparação dos projetos liberados", async () => {
    const mine = await makeProject("DIA-2");
    const other = await makeProject("DIA-3");
    const user = await makeUser("coord2@teste.com", { profileRole: "coordenador" });
    await setUserProjectIds(user.id, [mine]);
    await captureDailySnapshot({ date: "2026-10-07" });
    const result = await appRouter.createCaller(ctxOf(user)).daily.compare({ toDate: "2026-10-07", fromDate: "2026-10-06" });
    const ids = result.projects.map((p) => p.projectId);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);
    await expect(appRouter.createCaller(ctxOf(user)).daily.projectTrend({ projectId: other })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
