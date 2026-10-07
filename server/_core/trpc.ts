import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getUserProjectIds } from "../db";
import { buildAccessScope } from "./access";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/** Usuário autenticado + escopo de projetos (admin = todos; demais = liberados). */
export const scopedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const assigned = ctx.user.role === "admin" ? [] : await getUserProjectIds(ctx.user.id);
  return next({ ctx: { ...ctx, scope: buildAccessScope(ctx.user, assigned) } });
});

/** Como scopedProcedure, mas exige perfil com permissão de escrita (admin/coordenador). */
export const writerProcedure = scopedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.scope.canWrite) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Seu perfil tem acesso somente de leitura." });
  }
  return next();
});
