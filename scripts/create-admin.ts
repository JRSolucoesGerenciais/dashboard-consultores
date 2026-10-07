/**
 * Cria (ou promove/redefine a senha de) o primeiro administrador.
 *
 *   ADMIN_EMAIL=voce@empresa.com ADMIN_NAME="Seu Nome" ADMIN_PASSWORD='...' \
 *     pnpm tsx scripts/create-admin.ts
 *
 * A senha vem do ambiente para não ficar no histórico do shell nem no Git.
 */
import "dotenv/config";
import { localOpenId, normalizeEmail } from "../server/_core/access";
import { hashPassword } from "../server/_core/password";
import { createLocalUser, getUserByEmail, updateUserAdmin } from "../server/db";

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME?.trim() || "Administrador";
  if (!email || !password) throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD.");

  const passwordHash = await hashPassword(password);
  const existing = await getUserByEmail(email);
  if (existing) {
    await updateUserAdmin(existing.id, { role: "admin", status: "ativo", passwordHash, name });
    console.log(`Usuário ${email} promovido a administrador e senha redefinida.`);
  } else {
    await createLocalUser({ openId: localOpenId(email), email, name, passwordHash, role: "admin", profileRole: "coordenador", status: "ativo" });
    console.log(`Administrador ${email} criado.`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
