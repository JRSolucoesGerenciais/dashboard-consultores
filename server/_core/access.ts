/**
 * Regras de acesso por perfil (puras, sem banco).
 *
 * - admin (users.role = "admin"): vê e altera tudo, gerencia usuários e importações.
 * - coordenador: vê e altera (check-ins, riscos) apenas os projetos liberados.
 * - cliente: apenas leitura, apenas dos projetos liberados.
 *
 * Perfis legados do Manus (diretoria, pmo, gerente, consultor) são tratados
 * como coordenador: escopo restrito aos projetos liberados, com escrita.
 */
export type AccessUser = {
  role: "admin" | "user";
  profileRole: string;
  status: "pendente" | "ativo" | "bloqueado";
};

export type AccessScope = {
  isAdmin: boolean;
  canWrite: boolean;
  /** null = todos os projetos */
  projectIds: ReadonlySet<number> | null;
  canAccessProject: (projectId: number) => boolean;
  filterProjectIds: (ids: number[]) => number[];
  filterByProject: <T extends { projectId: number }>(rows: T[]) => T[];
  filterProjects: <T extends { id: number }>(rows: T[]) => T[];
};

export function buildAccessScope(user: AccessUser, assignedProjectIds: number[]): AccessScope {
  const isAdmin = user.role === "admin";
  const active = user.status === "ativo";
  const ids = isAdmin ? null : new Set(active ? assignedProjectIds : []);
  const canAccessProject = (projectId: number) => ids === null || ids.has(projectId);
  return {
    isAdmin,
    canWrite: active && (isAdmin || user.profileRole !== "cliente"),
    projectIds: ids,
    canAccessProject,
    filterProjectIds: (list) => (ids === null ? list : list.filter((id) => ids.has(id))),
    filterByProject: (rows) => (ids === null ? rows : rows.filter((row) => ids.has(row.projectId))),
    filterProjects: (rows) => (ids === null ? rows : rows.filter((row) => ids.has(row.id))),
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const LOCAL_OPEN_ID_PREFIX = "local:";
export const localOpenId = (email: string) => `${LOCAL_OPEN_ID_PREFIX}${normalizeEmail(email)}`;
