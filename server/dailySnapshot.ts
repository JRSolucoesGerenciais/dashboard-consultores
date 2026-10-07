import { diffDailySnapshots, type ModuleSnap, type ProjectSnap } from "@shared/dailyDiff";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { dailyModuleSnapshots, dailyProjectSnapshots } from "../drizzle/schema";
import { getAllProjectActivities, getDb, getProjectsList } from "./db";
import { buildManagementModuleSummary } from "./ppsahours";

/** Data civil no fuso de Brasília (YYYY-MM-DD). */
export function brasiliaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

const num = (value: unknown) => Number(value ?? 0) || 0;
const fixed = (value: number) => value.toFixed(2);
const BATCH = 500;

/**
 * Grava (ou regrava) a foto do dia a partir do estado publicado no banco.
 * Idempotente: rodar duas vezes no mesmo dia substitui a foto daquele dia.
 */
export async function captureDailySnapshot(options: { date?: string; syncRunId?: number | null } = {}) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const snapshotDate = options.date ?? brasiliaDate();

  const [projects, activities] = await Promise.all([getProjectsList(), getAllProjectActivities()]);
  const activitiesByProject = new Map<number, typeof activities>();
  for (const activity of activities) {
    const list = activitiesByProject.get(activity.projectId);
    if (list) list.push(activity); else activitiesByProject.set(activity.projectId, [activity]);
  }

  const projectRows: (typeof dailyProjectSnapshots.$inferInsert)[] = [];
  const moduleRows: (typeof dailyModuleSnapshots.$inferInsert)[] = [];

  for (const project of projects) {
    const plannedHours = num(project.plannedHours);
    const actualHours = num(project.actualHours);
    projectRows.push({
      snapshotDate,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name.slice(0, 255),
      client: project.client.slice(0, 255),
      status: project.status,
      plannedHours: fixed(plannedHours),
      actualHours: fixed(actualHours),
      completionPct: fixed(num(project.completionPct)),
      totalActivities: project.totalActivities ?? 0,
      syncRunId: options.syncRunId ?? null,
    });

    const summary = buildManagementModuleSummary(activitiesByProject.get(project.id) ?? [], { plannedHours, actualHours });
    const seen = new Set<string>();
    for (const item of summary) {
      const managementName = item.managementName.slice(0, 120);
      const moduleName = item.moduleName.slice(0, 120);
      const key = `${managementName}|${moduleName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moduleRows.push({
        snapshotDate,
        projectId: project.id,
        managementName,
        moduleName,
        plannedHours: fixed(item.plannedHours),
        actualHours: fixed(item.actualHours),
        completionPct: fixed(item.hoursProgressPct),
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(dailyProjectSnapshots).where(eq(dailyProjectSnapshots.snapshotDate, snapshotDate));
    await tx.delete(dailyModuleSnapshots).where(eq(dailyModuleSnapshots.snapshotDate, snapshotDate));
    for (let i = 0; i < projectRows.length; i += BATCH) await tx.insert(dailyProjectSnapshots).values(projectRows.slice(i, i + BATCH));
    for (let i = 0; i < moduleRows.length; i += BATCH) await tx.insert(dailyModuleSnapshots).values(moduleRows.slice(i, i + BATCH));
  });

  return { snapshotDate, projects: projectRows.length, modules: moduleRows.length };
}

export async function listSnapshotDates(limit = 120): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.selectDistinct({ date: dailyProjectSnapshots.snapshotDate }).from(dailyProjectSnapshots).orderBy(desc(dailyProjectSnapshots.snapshotDate)).limit(limit);
  return rows.map((row) => row.date);
}

async function loadDay(date: string, projectIds: number[] | null): Promise<{ projects: ProjectSnap[]; modules: ModuleSnap[] }> {
  const db = await getDb();
  if (!db) return { projects: [], modules: [] };
  if (projectIds && projectIds.length === 0) return { projects: [], modules: [] };
  const projectFilter = projectIds ? and(eq(dailyProjectSnapshots.snapshotDate, date), inArray(dailyProjectSnapshots.projectId, projectIds)) : eq(dailyProjectSnapshots.snapshotDate, date);
  const moduleFilter = projectIds ? and(eq(dailyModuleSnapshots.snapshotDate, date), inArray(dailyModuleSnapshots.projectId, projectIds)) : eq(dailyModuleSnapshots.snapshotDate, date);
  const [projectRows, moduleRows] = await Promise.all([
    db.select().from(dailyProjectSnapshots).where(projectFilter),
    db.select().from(dailyModuleSnapshots).where(moduleFilter),
  ]);
  return {
    projects: projectRows.map((row) => ({
      projectId: row.projectId, projectCode: row.projectCode, projectName: row.projectName, client: row.client, status: row.status,
      plannedHours: num(row.plannedHours), actualHours: num(row.actualHours), completionPct: num(row.completionPct), totalActivities: row.totalActivities,
    })),
    modules: moduleRows.map((row) => ({
      projectId: row.projectId, managementName: row.managementName, moduleName: row.moduleName,
      plannedHours: num(row.plannedHours), actualHours: num(row.actualHours), completionPct: num(row.completionPct),
    })),
  };
}

/**
 * Compara `toDate` (padrão: foto mais recente) com `fromDate` (padrão: a foto
 * imediatamente anterior disponível). `projectIds = null` significa todos.
 */
export async function getDailyComparison(args: { toDate?: string; fromDate?: string; projectIds: number[] | null }) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const dates = await listSnapshotDates(400);
  const toDate = args.toDate ?? dates[0] ?? null;
  if (!toDate) return { toDate: null, fromDate: null, availableDates: dates, projects: [], totals: null };

  let fromDate = args.fromDate ?? null;
  if (!fromDate) {
    const previous = await db.selectDistinct({ date: dailyProjectSnapshots.snapshotDate }).from(dailyProjectSnapshots)
      .where(lt(dailyProjectSnapshots.snapshotDate, toDate)).orderBy(desc(dailyProjectSnapshots.snapshotDate)).limit(1);
    fromDate = previous[0]?.date ?? null;
  }
  if (!fromDate) return { toDate, fromDate: null, availableDates: dates, projects: [], totals: null };

  const [prev, curr] = await Promise.all([loadDay(fromDate, args.projectIds), loadDay(toDate, args.projectIds)]);
  const { projects, totals } = diffDailySnapshots(prev.projects, curr.projects, prev.modules, curr.modules);
  return { toDate, fromDate, availableDates: dates, projects, totals };
}

/** Série diária de um projeto, com as horas apontadas em cada dia. */
export async function getProjectDailyTrend(projectId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(dailyProjectSnapshots)
    .where(eq(dailyProjectSnapshots.projectId, projectId))
    .orderBy(desc(dailyProjectSnapshots.snapshotDate)).limit(days + 1);
  const ascending = rows.reverse();
  return ascending.slice(1).map((row, index) => {
    const before = ascending[index];
    return {
      date: row.snapshotDate,
      actualHours: num(row.actualHours),
      plannedHours: num(row.plannedHours),
      completionPct: num(row.completionPct),
      actualDelta: Math.round((num(row.actualHours) - num(before.actualHours)) * 100) / 100,
      plannedDelta: Math.round((num(row.plannedHours) - num(before.plannedHours)) * 100) / 100,
    };
  });
}
