import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { localOpenId, normalizeEmail } from "./_core/access";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./_core/password";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  countActiveAdmins,
  createLocalUser,
  getExistingProjectIds,
  getUserByEmail,
  getUserById,
  listUsersWithAccess,
  setUserProjectIds,
  updateUserAdmin,
} from "./db";

const profileRole = z.enum(["coordenador", "cliente"]);
const password = z.string().min(MIN_PASSWORD_LENGTH).max(200);

async function assertAdminRemains(targetId: number, selfId: number, change: "demote" | "block") {
  const target = await getUserById(targetId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
  if (target.role === "admin" && target.status === "ativo") {
    if (targetId === selfId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode remover o próprio acesso de administrador." });
    }
    if ((await countActiveAdmins()) <= 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Deve existir ao menos um administrador ativo (${change}).` });
    }
  }
}

async function validProjectIds(ids: number[]) {
  const existing = await getExistingProjectIds(ids);
  if (existing.length !== new Set(ids).size) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Um ou mais projetos informados não existem." });
  }
  return existing;
}

export const adminRouter = router({
  listUsers: adminProcedure.query(() => listUsersWithAccess()),

  createUser: adminProcedure
    .input(z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().max(320),
      password,
      role: z.enum(["admin", "user"]).default("user"),
      profileRole: profileRole.default("cliente"),
      projectIds: z.array(z.number().int().positive()).max(2000).default([]),
    }))
    .mutation(async ({ input }) => {
      const email = normalizeEmail(input.email);
      if (await getUserByEmail(email)) {
        throw new TRPCError({ code: "CONFLICT", message: "Já existe um usuário com este e-mail." });
      }
      const projectIds = await validProjectIds(input.projectIds);
      const user = await createLocalUser({
        openId: localOpenId(email),
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        profileRole: input.profileRole,
        status: "ativo",
      });
      if (user) await setUserProjectIds(user.id, projectIds);
      return { success: true };
    }),

  updateUser: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(2).max(120).optional(),
      role: z.enum(["admin", "user"]).optional(),
      profileRole: profileRole.optional(),
      status: z.enum(["pendente", "ativo", "bloqueado"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      if (patch.role === "user") await assertAdminRemains(id, ctx.user.id, "demote");
      if (patch.status && patch.status !== "ativo") await assertAdminRemains(id, ctx.user.id, "block");
      await updateUserAdmin(id, patch);
      return { success: true };
    }),

  setUserProjects: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), projectIds: z.array(z.number().int().positive()).max(2000) }))
    .mutation(async ({ input }) => {
      if (!(await getUserById(input.userId))) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      await setUserProjectIds(input.userId, await validProjectIds(input.projectIds));
      return { success: true };
    }),

  resetPassword: adminProcedure
    .input(z.object({ id: z.number().int().positive(), password }))
    .mutation(async ({ input }) => {
      if (!(await getUserById(input.id))) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado." });
      await updateUserAdmin(input.id, { passwordHash: await hashPassword(input.password) });
      return { success: true };
    }),
});

export const selfServiceRouter = {
  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }))
    .mutation(async ({ input, ctx }) => {
      const user = await getUserById(ctx.user.id);
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha atual incorreta." });
      }
      await updateUserAdmin(user.id, { passwordHash: await hashPassword(input.newPassword) });
      return { success: true };
    }),
};
