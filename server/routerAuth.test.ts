import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function ctxFor(user: Partial<NonNullable<TrpcContext["user"]>> | null): TrpcContext {
  return {
    user: user && {
      id: 7,
      openId: "local:teste@exemplo.com",
      name: "Teste",
      email: "teste@exemplo.com",
      loginMethod: "senha",
      role: "user",
      profileRole: "cliente",
      status: "ativo",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...user,
    },
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

describe("proteção das rotas", () => {
  it("visitante sem login é barrado em leitura, escrita e administração", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.projects.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.projects.getPortfolioMetrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.projects.getOracleConfig()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.admin.listUsers()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("cliente e coordenador não acessam importação, API CSAgenda nem gestão de usuários", async () => {
    for (const profileRole of ["cliente", "coordenador"] as const) {
      const caller = appRouter.createCaller(ctxFor({ profileRole }));
      await expect(caller.projects.getOracleConfig()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.projects.rollbackOracleSyncRun({ runId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.projects.getImportBatches()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.admin.listUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.admin.updateUser({ id: 1, role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("cliente é somente leitura: não registra check-in, risco nem snapshot", async () => {
    const caller = appRouter.createCaller(ctxFor({ profileRole: "cliente" }));
    await expect(caller.projects.addRisk({
      projectId: 1, title: "x", category: "x", severity: "baixo", probability: "baixo",
      impact: "x", mitigationPlan: "x", owner: "x",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.projects.updateRiskStatus({ riskId: 1, status: "resolvido" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("auth.me nunca expõe o hash da senha", async () => {
    const me = await appRouter.createCaller(ctxFor({})).auth.me();
    expect(me).not.toHaveProperty("passwordHash");
  });
});
