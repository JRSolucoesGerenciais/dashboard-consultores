import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openId: null as string | null, user: undefined as any }));
vi.mock("./_core/session", () => ({ readSessionOpenId: async () => state.openId }));
vi.mock("./db", () => ({ getUserByOpenId: async () => state.user }));

import { requireAdminHttp, requireUserHttp } from "./_core/httpAuth";

function run(middleware: typeof requireAdminHttp) {
  const result = { status: 0, nextCalled: false };
  const res: any = {
    status(code: number) { result.status = code; return res; },
    json() { return res; },
  };
  return middleware({} as any, res, () => { result.nextCalled = true; }).then(() => result);
}

describe("proteção das rotas HTTP", () => {
  beforeEach(() => { state.openId = null; state.user = undefined; });

  it("sem sessão: 401 e não segue", async () => {
    expect(await run(requireAdminHttp)).toEqual({ status: 401, nextCalled: false });
    expect(await run(requireUserHttp)).toEqual({ status: 401, nextCalled: false });
  });

  it("usuário pendente ou bloqueado: 401", async () => {
    state.openId = "local:a@b.com";
    for (const status of ["pendente", "bloqueado"]) {
      state.user = { role: "admin", status };
      expect((await run(requireAdminHttp)).status).toBe(401);
    }
  });

  it("não admin: 403 no upload, mas passa nas rotas de usuário comum", async () => {
    state.openId = "local:a@b.com";
    state.user = { role: "user", status: "ativo" };
    expect(await run(requireAdminHttp)).toEqual({ status: 403, nextCalled: false });
    expect((await run(requireUserHttp)).nextCalled).toBe(true);
  });

  it("admin ativo passa", async () => {
    state.openId = "local:a@b.com";
    state.user = { role: "admin", status: "ativo" };
    expect((await run(requireAdminHttp)).nextCalled).toBe(true);
  });
});
