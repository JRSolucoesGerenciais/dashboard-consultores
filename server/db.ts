import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertProject,
  InsertProjectActivity,
  InsertProjectRisk,
  InsertUser,
  InsertWeeklyUpdate,
  InsertSCurveSnapshot,
  projectActivities,
  projectImportBatches,
  projectRisks,
  projects,
  sCurveSnapshots,
  userProjectAccess,
  users,
  weeklyUpdates,
  weeklyUpdateAttachments,
  InsertWeeklyUpdateAttachment,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { canonicalizePersistedPpsaRows } from "./ppsahours";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  textFields.forEach((field) => {
    const val = user[field];
    if (val !== undefined) {
      values[field] = val ?? null;
      updateSet[field] = val ?? null;
    }
  });

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (user.profileRole !== undefined) {
    values.profileRole = user.profileRole;
    updateSet.profileRole = user.profileRole;
  }

  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getProjectsList(search?: string) {
  const db = await getDb();
  if (!db) return [];
  if (search && search.trim() !== "") {
    const query = `%${search.trim()}%`;
    return db
      .select()
      .from(projects)
      .where(or(like(projects.code, query), like(projects.name, query), like(projects.client, query)))
      .orderBy(projects.code);
  }
  return db.select().from(projects).orderBy(projects.code);
}

export async function getProjectById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result[0];
}

export async function getProjectActivities(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(projectActivities)
    .where(eq(projectActivities.projectId, projectId))
    .orderBy(projectActivities.ppsaCode);
  return canonicalizePersistedPpsaRows(rows);
}

export async function getAllProjectActivities() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(projectActivities).orderBy(projectActivities.projectId, projectActivities.ppsaCode);
  return canonicalizePersistedPpsaRows(rows);
}

export async function getProjectRisks(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectRisks).where(eq(projectRisks.projectId, projectId)).orderBy(desc(projectRisks.id));
}

export async function getAllOpenRisks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectRisks).where(eq(projectRisks.status, "aberto")).orderBy(desc(projectRisks.id));
}

export async function getProjectWeeklyUpdates(projectId?: number) {
  const db = await getDb();
  if (!db) return [];
  const baseQuery = projectId
    ? db.select().from(weeklyUpdates).where(eq(weeklyUpdates.projectId, projectId)).orderBy(desc(weeklyUpdates.id))
    : db.select().from(weeklyUpdates).orderBy(desc(weeklyUpdates.id));
  const updates = await baseQuery;
  const updateIds = updates.map((u) => u.id);
  const attachments = updateIds.length > 0
    ? await db.select().from(weeklyUpdateAttachments).orderBy(desc(weeklyUpdateAttachments.id))
    : [];
  const attachmentsByUpdateId = new Map<number, typeof attachments>();
  attachments.forEach((att) => {
    attachmentsByUpdateId.set(att.weeklyUpdateId, [...(attachmentsByUpdateId.get(att.weeklyUpdateId) || []), att]);
  });
  return updates.map((u) => ({
    ...u,
    attachments: attachmentsByUpdateId.get(u.id) || [],
  }));
}

export async function getImportBatches() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectImportBatches).orderBy(desc(projectImportBatches.id)).limit(5);
}

export async function getSCurveSnapshots(projectId: number, moduleName?: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(sCurveSnapshots)
    .where(eq(sCurveSnapshots.projectId, projectId))
    .orderBy(desc(sCurveSnapshots.id));
  if (!moduleName || moduleName === "todos") return rows;
  return rows.filter((row) => row.moduleName === moduleName || row.moduleName === "todos");
}

export async function createSCurveSnapshot(snapshot: InsertSCurveSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  const [result] = await db.insert(sCurveSnapshots).values(snapshot);
  return result;
}

export async function createWeeklyUpdate(update: InsertWeeklyUpdate, attachments: InsertWeeklyUpdateAttachment[] = []) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  const result = await db.insert(weeklyUpdates).values(update);
  const weeklyUpdateId = Number((result as any)?.[0]?.insertId || 0);
  if (weeklyUpdateId > 0 && attachments.length > 0) {
    const rows = attachments.map((att) => ({ ...att, weeklyUpdateId }));
    await db.insert(weeklyUpdateAttachments).values(rows);
  }

  await db
    .update(projects)
    .set({
      status: update.ragStatus,
      completionPct: update.physicalProgressPct,
      spi: update.spiValue,
      cpi: update.cpiValue,
    })
    .where(eq(projects.id, update.projectId));

  return result;
}

export async function createProjectRisk(risk: InsertProjectRisk) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  return db.insert(projectRisks).values(risk);
}

export async function updateRiskStatus(riskId: number, status: "aberto" | "em_mitigacao" | "resolvido") {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível");
  return db
    .update(projectRisks)
    .set({
      status,
      resolvedAt: status === "resolvido" ? new Date() : null,
    })
    .where(eq(projectRisks.id, riskId));
}

// ---------------------------------------------------------------------------
// Usuários locais (login próprio) e acesso por projeto
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function createLocalUser(data: {
  openId: string;
  email: string;
  name: string;
  passwordHash: string;
  role?: "admin" | "user";
  profileRole?: InsertUser["profileRole"];
  status?: "pendente" | "ativo" | "bloqueado";
}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");
  await db.insert(users).values({
    openId: data.openId,
    email: data.email,
    name: data.name,
    loginMethod: "senha",
    passwordHash: data.passwordHash,
    role: data.role ?? "user",
    profileRole: data.profileRole ?? "cliente",
    status: data.status ?? "pendente",
  });
  return getUserByEmail(data.email);
}

export async function touchLastSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function listUsersWithAccess() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    profileRole: users.profileRole,
    status: users.status,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.createdAt));
  const access = await db.select().from(userProjectAccess);
  return rows.map((row) => ({
    ...row,
    projectIds: access.filter((entry) => entry.userId === row.id).map((entry) => entry.projectId),
  }));
}

export async function updateUserAdmin(
  userId: number,
  patch: Partial<Pick<InsertUser, "name" | "role" | "profileRole" | "status" | "passwordHash">>,
) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");
  await db.update(users).set(patch).where(eq(users.id, userId));
}

export async function countActiveAdmins() {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "ativo")));
  return rows.length;
}

export async function getUserProjectIds(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(userProjectAccess).where(eq(userProjectAccess.userId, userId));
  return rows.map((row) => row.projectId);
}

export async function setUserProjectIds(userId: number, projectIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");
  const unique = Array.from(new Set(projectIds));
  await db.transaction(async (tx) => {
    await tx.delete(userProjectAccess).where(eq(userProjectAccess.userId, userId));
    if (unique.length > 0) {
      await tx.insert(userProjectAccess).values(unique.map((projectId) => ({ userId, projectId })));
    }
  });
}

export async function getExistingProjectIds(ids: number[]): Promise<number[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const rows = await db.select({ id: projects.id }).from(projects).where(inArray(projects.id, ids));
  return rows.map((row) => row.id);
}

export async function getRiskProjectId(riskId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ projectId: projectRisks.projectId }).from(projectRisks).where(eq(projectRisks.id, riskId)).limit(1);
  return rows[0]?.projectId ?? null;
}
