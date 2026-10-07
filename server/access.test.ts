import { describe, expect, it } from "vitest";
import { buildAccessScope, localOpenId, normalizeEmail } from "./_core/access";
import { hashPassword, verifyPassword } from "./_core/password";

const base = { role: "user" as const, status: "ativo" as const };

describe("hash de senha", () => {
  it("valida a senha correta e rejeita a errada", async () => {
    const hash = await hashPassword("senha-bem-longa-123");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("senha-bem-longa-123", hash)).toBe(true);
    expect(await verifyPassword("outra-senha-123", hash)).toBe(false);
  });

  it("gera hashes diferentes para a mesma senha (salt)", async () => {
    expect(await hashPassword("senha-bem-longa-123")).not.toBe(await hashPassword("senha-bem-longa-123"));
  });

  it("rejeita senha curta e hash ausente ou malformado", async () => {
    await expect(hashPassword("curta")).rejects.toThrow();
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "lixo")).toBe(false);
  });
});

describe("escopo de acesso por perfil", () => {
  it("admin vê todos os projetos e pode escrever", () => {
    const scope = buildAccessScope({ ...base, role: "admin", profileRole: "coordenador" }, []);
    expect(scope.projectIds).toBeNull();
    expect(scope.canAccessProject(999)).toBe(true);
    expect(scope.canWrite).toBe(true);
  });

  it("coordenador só acessa os projetos liberados e pode escrever", () => {
    const scope = buildAccessScope({ ...base, profileRole: "coordenador" }, [1, 2]);
    expect(scope.canAccessProject(1)).toBe(true);
    expect(scope.canAccessProject(3)).toBe(false);
    expect(scope.canWrite).toBe(true);
    expect(scope.filterProjectIds([1, 2, 3])).toEqual([1, 2]);
    expect(scope.filterProjects([{ id: 2 }, { id: 3 }])).toEqual([{ id: 2 }]);
    expect(scope.filterByProject([{ projectId: 1 }, { projectId: 9 }])).toEqual([{ projectId: 1 }]);
  });

  it("cliente é somente leitura", () => {
    const scope = buildAccessScope({ ...base, profileRole: "cliente" }, [5]);
    expect(scope.canAccessProject(5)).toBe(true);
    expect(scope.canWrite).toBe(false);
  });

  it("usuário sem projetos liberados não vê nada", () => {
    const scope = buildAccessScope({ ...base, profileRole: "cliente" }, []);
    expect(scope.filterProjectIds([1, 2])).toEqual([]);
    expect(scope.canAccessProject(1)).toBe(false);
  });

  it("usuário pendente ou bloqueado não acessa nem escreve, mesmo com projetos", () => {
    for (const status of ["pendente", "bloqueado"] as const) {
      const scope = buildAccessScope({ role: "user", status, profileRole: "coordenador" }, [1]);
      expect(scope.canAccessProject(1)).toBe(false);
      expect(scope.canWrite).toBe(false);
    }
  });

  it("normaliza e-mail e gera openId local", () => {
    expect(normalizeEmail("  Ana@Empresa.COM ")).toBe("ana@empresa.com");
    expect(localOpenId("Ana@Empresa.com")).toBe("local:ana@empresa.com");
  });
});
