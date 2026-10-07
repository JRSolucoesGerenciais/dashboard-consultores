import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { adminRouter, selfServiceRouter } from "./adminRouter";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router, scopedProcedure, writerProcedure } from "./_core/trpc";
import {
  createProjectRisk,
  createWeeklyUpdate,
  getAllOpenRisks,
  getImportBatches,
  getAllProjectActivities,
  getProjectActivities,
  getProjectById,
  getProjectRisks,
  getProjectsList,
  getRiskProjectId,
  getProjectWeeklyUpdates,
  updateRiskStatus,
} from "./db";
import { storagePut } from "./storage";
import {
  processAndImportSpreadsheet,
  validateSpreadsheetBuffer,
} from "./spreadsheetService";
import { createSCurveSnapshot, getSCurveSnapshots } from "./db";
import { calculateSCurve, parseSnapshotPoints } from "./sCurveService";
import { buildManagementModuleSummary } from "./ppsahours";
import { sumCanonicalActualHours, sumCanonicalPlannedHours } from "@shared/hierarchyHours";
import {
  getOracleConfig,
  getOracleSyncRunStatus,
  listOracleSyncRuns,
  publishAnalyzedPreview,
  rollbackOracleSyncRun,
  saveOracleConfig,
  testOracleConnection,
} from "./oracleSyncService";
import { processParsedSpreadsheetRows } from "./spreadsheetService";
import {
  appendSpreadsheetImportChunk,
  createSpreadsheetImportSession,
  getSpreadsheetImportSessionStatus,
  startProcessingSpreadsheetImportSession,
  takeSpreadsheetImportSession,
} from "./spreadsheetImportStaging";

function forbidProject() {
  return new TRPCError({ code: "FORBIDDEN", message: "Você não tem acesso a este projeto." });
}

function projectActualHours(project: { actualHours?: unknown; productiveActualHours?: unknown; hoursMetricsSource?: string | null; projectType?: string | null; projectTypeDescription?: string | null }) {
  return Number(project.actualHours ?? 0);
}

export const appRouter = router({
  system: systemRouter,
  admin: adminRouter,
  auth: router({
    ...selfServiceRouter,
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  projects: router({
    list: scopedProcedure
      .input(z.object({ search: z.string().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return ctx.scope.filterProjects(await getProjectsList(input?.search));
      }),

    getImportBatches: adminProcedure.query(async () => {
      return await getImportBatches();
    }),

    validateSpreadsheet: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          fileBase64: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        return validateSpreadsheetBuffer(input.fileName, buffer);
      }),

    importSpreadsheet: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          fileBase64: z.string(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        return await processAndImportSpreadsheet(input.fileName, buffer, input.notes);
      }),

    getVisualControl: scopedProcedure
      .input(z.object({ projectId: z.number().optional(), weekOffset: z.number().int().min(-100).max(100).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
      .query(async ({ input, ctx }) => {
        const allProjects = ctx.scope.filterProjects(await getProjectsList());
        const selectedId = input?.projectId;
        if (selectedId && !ctx.scope.canAccessProject(selectedId)) throw forbidProject();
        const weekOffset = input?.weekOffset || 0;
        const month = input?.month;
        const activities = selectedId ? await getProjectActivities(selectedId) : [];
        const weeklyUpdates = selectedId ? await getProjectWeeklyUpdates(selectedId) : [];

        const toDate = (value: unknown) => {
          if (!value) return null;
          const parsed = new Date(String(value));
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const fmt = (value: Date) => `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}`;
        const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
        const startOfMonday = (value: Date) => {
          const date = startOfDay(value);
          date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
          return date;
        };
        const startOfSunday = (value: Date) => {
          const date = startOfDay(value);
          date.setDate(date.getDate() + (7 - date.getDay()) % 7);
          return date;
        };

        const modules = Array.from(new Set(activities.map((activity) => activity.moduleName).filter(Boolean))).sort();
        const consultants = Array.from(new Set(activities.map((activity) => activity.resource).filter(Boolean))).sort();

        const buildTimeline = (project: (typeof allProjects)[number], activities: Awaited<ReturnType<typeof getProjectActivities>>, updates: Awaited<ReturnType<typeof getProjectWeeklyUpdates>> = []) => {
          const operationalActivities = activities.some((activity) => activity.level === 1)
            ? activities.filter((activity) => activity.level === 1)
            : activities;
          const today = startOfDay(new Date());
          const isLate = (activity: (typeof activities)[number]) => {
            const end = toDate(activity.plannedEnd);
            return Boolean(end && end < today && activity.status !== "concluido" && Number(activity.progressPct || 0) < 100);
          };
          const rawPlannedHours = sumCanonicalPlannedHours(operationalActivities);
          const rawActualHours = sumCanonicalActualHours(operationalActivities);
          const totalPlannedHours = Number(project.plannedHours || 0) > 0
            ? Number(project.plannedHours)
            : rawPlannedHours;
          const progressAtDate = (activity: (typeof activities)[number], date: Date) => {
            const startDate = toDate(activity.plannedStart);
            const endDate = toDate(activity.plannedEnd) || startDate;
            if (!startDate || !endDate) return 0;
            if (date.getTime() <= startDate.getTime()) return 0;
            if (date.getTime() >= endDate.getTime()) return 1;
            const duration = Math.max(1, endDate.getTime() - startDate.getTime());
            return Math.max(0, Math.min(1, (date.getTime() - startDate.getTime()) / duration));
          };
          const updateDate = (reference: string) => {
            const dateMatch = reference.match(/(\d{1,2})\/(\d{1,2})/);
            const yearMatch = reference.match(/(19|20)\d{2}/);
            if (!dateMatch) return null;
            const day = Number(dateMatch[1]);
            const monthIndex = Number(dateMatch[2]) - 1;
            const year = yearMatch ? Number(yearMatch[0]) : today.getFullYear();
            const date = new Date(year, monthIndex, day);
            return Number.isNaN(date.getTime()) ? null : startOfDay(date);
          };
          const datedUpdates = updates.map((update) => ({ update, date: updateDate(update.weekReference) })).filter((item) => item.date);
          const activityDates = activities
            .flatMap((activity) => [toDate(activity.plannedStart), toDate(activity.plannedEnd)])
            .filter((date): date is Date => Boolean(date));
          const dates = (activityDates.length > 0 ? activityDates : [
            toDate(project.startDate),
            toDate(project.plannedEndDate),
            toDate(project.projectedEndDate),
            toDate(project.finalDate),
          ]).filter((date): date is Date => Boolean(date));
          const firstDate = startOfMonday(new Date(Math.min(...dates.map((date) => date.getTime())) || Date.now()));
          let start = startOfDay(new Date(firstDate.getTime() + weekOffset * 35 * 86400000));
          let periodCount = 5;
          if (month) {
            const [year, monthNumber] = month.split("-").map(Number);
            const monthStart = new Date(year, monthNumber - 1, 1);
            const monthEnd = new Date(year, monthNumber, 0);
            start = startOfMonday(monthStart);
            const end = startOfSunday(monthEnd);
            periodCount = Math.floor((end.getTime() - start.getTime()) / (7 * 86400000)) + 1;
          }
          const activityPeriodIndex = new Map<number, number>();

          const periods = Array.from({ length: periodCount }, (_, index) => {
            const periodStart = startOfDay(new Date(start.getTime() + index * 7 * 86400000));
            const periodEnd = startOfDay(new Date(periodStart.getTime() + 6 * 86400000));
            const weekNumber = Math.floor((periodStart.getTime() - firstDate.getTime()) / (7 * 86400000)) + 1;
            const periodActivities = operationalActivities.filter((activity) => {
              const activityStart = toDate(activity.plannedStart);
              const activityEnd = toDate(activity.plannedEnd) || activityStart;
              if (!activityStart && !activityEnd) return false;
              const leftDate = activityStart ?? activityEnd;
              const rightDate = activityEnd ?? activityStart;
              if (!leftDate || !rightDate) return false;
              const left = leftDate.getTime();
              const right = rightDate.getTime();
              return left <= periodEnd.getTime() && right >= periodStart.getTime();
            });
            periodActivities.forEach((activity) => {
              if (!activityPeriodIndex.has(activity.id)) activityPeriodIndex.set(activity.id, index + 1);
            });
            const rawPeriodActualHours = sumCanonicalActualHours(periodActivities);
            const actualHours = rawPeriodActualHours;
            const completed = periodActivities.filter((activity) => activity.status === "concluido").length;
            const plannedValue = operationalActivities.reduce((sum, activity) => sum + Number(activity.plannedHours || 0) * progressAtDate(activity, periodEnd), 0);
            const rawActualToDate = sumCanonicalActualHours(operationalActivities.filter((activity) => {
              const startDate = toDate(activity.plannedStart) || toDate(activity.plannedEnd);
              return Boolean(startDate && startDate <= periodEnd);
            }));
            const actualToDate = rawActualToDate;
            const informedUpdate = datedUpdates.filter((item) => item.date && item.date <= periodEnd).sort((left, right) => left.date!.getTime() - right.date!.getTime()).at(-1)?.update;
            const remote = periodActivities.filter((activity) => /remot|online|home/i.test(activity.location || "")).length;
            const resources = new Set(periodActivities.map((activity) => activity.resource).filter(Boolean));
            const progress = periodActivities.length ? Math.round((completed / periodActivities.length) * 100) : 0;
            const state = periodActivities.length === 0 ? "empty" : completed === periodActivities.length ? "done" : actualHours > 0 ? "progress" : "planned";
            return {
              key: `${project.id}-${index}`,
              index: index + 1,
              weekNumber,
              label: `Semana ${weekNumber}`,
              range: `${fmt(periodStart)} – ${fmt(periodEnd)}`,
              startDate: periodStart.toISOString().slice(0, 10),
              endDate: periodEnd.toISOString().slice(0, 10),
              activities: periodActivities.length,
              completed,
              actualHours: Number(actualHours.toFixed(1)),
              progress,
              plannedHours: Number(periodActivities.reduce((sum, activity) => sum + Number(activity.plannedHours || 0), 0).toFixed(1)),
              plannedHoursToDate: Number(plannedValue.toFixed(1)),
              actualHoursToDate: Number(actualToDate.toFixed(1)),
              calculatedProgress: Number(Math.min(100, totalPlannedHours > 0 ? (actualToDate / totalPlannedHours) * 100 : 0).toFixed(1)),
              programmedProgress: Number((totalPlannedHours > 0 ? (plannedValue / totalPlannedHours) * 100 : 0).toFixed(1)),
              informedProgress: informedUpdate ? Number(informedUpdate.physicalProgressPct || 0) : 0,
              lateActivities: periodActivities.filter(isLate).length,
              remote,
              onsite: periodActivities.length - remote,
              resources: resources.size,
              state,
            };
          });

          const noDateActivities = activities.filter((activity) => !toDate(activity.plannedStart) && !toDate(activity.plannedEnd)).length;
          const lateActivities = operationalActivities.filter(isLate).length;
          const windowEnd = new Date(start.getTime() + (periodCount * 7 - 1) * 86400000);
          return { periods, noDateActivities, lateActivities, activityPeriodIndex, window: `${fmt(start)} – ${fmt(windowEnd)}` };
        };

        const rows = allProjects.map((project) => {
          const isCurrent = selectedId === project.id;
          const projectActivities = isCurrent ? activities : [];
          const timeline = buildTimeline(project, projectActivities, isCurrent ? weeklyUpdates : []);
          return {
            id: project.id,
            code: project.code,
            name: project.name,
            client: project.client,
            managerName: project.managerName,
            status: project.status,
            completionPct: project.completionPct,
            actualHours: project.actualHours,
            plannedHours: project.plannedHours,
            totalActivities: project.totalActivities,
            totalModules: project.totalModules,
            modules: isCurrent ? modules : [],
            consultants: isCurrent ? consultants : [],
            window: timeline.window,
            noDateActivities: timeline.noDateActivities,
            lateActivities: timeline.lateActivities,
            periods: timeline.periods,
          };
        });

        const selected = selectedId ? rows.find((row) => row.id === selectedId) : undefined;
        const selectedTimeline = selected ? buildTimeline(allProjects.find((project) => project.id === selectedId)!, activities, weeklyUpdates) : undefined;
        return {
          rows,
          selected,
          selectedActivities: activities.map((activity) => ({
            ...activity,
            visualPeriod: selectedTimeline?.activityPeriodIndex.get(activity.id) ?? null,
          })),
          weeklyUpdates,
          periodCount: selectedTimeline?.periods.length || 0,
          filterOptions: {
            modules,
            consultants,
            statuses: ["todos", "verde", "amarelo", "vermelho", "sem_classificacao"],
          },
          source: "ResumoGeraldosProjetos.xls / Select dual",
        };
      }),

    getHoursComparison: scopedProcedure.query(async ({ ctx }) => {
      const projects = ctx.scope.filterProjects(await getProjectsList());
      return [...projects]
        .sort((a, b) => projectActualHours(b) - projectActualHours(a))
        .slice(0, 10)
        .map((project) => ({
          code: project.code,
          project_name: project.name,
          client: project.client,
          manager: project.managerName,
          actual_hours: projectActualHours(project),
          planned_hours: Number(project.plannedHours || 0),
          baseline_hours: Number(project.baselineHours || 0),
        }));
    }),

    getHoursSummary: scopedProcedure
      .input(z.object({
        projectIds: z.array(z.number().int().positive()).min(1).max(1000),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }))
      .query(async ({ input, ctx }) => {
        const [projects, allActivities] = await Promise.all([getProjectsList(), getAllProjectActivities()]);
        const projectIdSet = new Set(ctx.scope.filterProjectIds(input.projectIds));
        const selectedProjects = projects.filter((project) => projectIdSet.has(project.id));
        const activitiesByProject = new Map<number, typeof allActivities>();
        allActivities.forEach((activity) => {
          if (!projectIdSet.has(activity.projectId)) return;
          activitiesByProject.set(activity.projectId, [...(activitiesByProject.get(activity.projectId) || []), activity]);
        });
        const toDate = (value: unknown) => {
          if (!value || String(value) === "Sem data") return null;
          const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const asOfDate = input.periodEnd ? toDate(input.periodEnd) : new Date(new Date().setHours(0, 0, 0, 0));
        const todayIso = new Date().toISOString().slice(0, 10);
        let totalPlannedHours = 0;
        let totalActualHours = 0;
        let plannedHoursToDate = 0;
        let actualHoursToDate = 0;
        selectedProjects.forEach((project) => {
          const activities = activitiesByProject.get(project.id) || [];
          const base = activities.some((activity) => activity.level === 1) ? activities.filter((activity) => activity.level === 1) : activities;
          const projectActivities = base.length > 0 ? base : [];
          const rawPlanned = sumCanonicalPlannedHours(projectActivities);
          const rawActual = sumCanonicalActualHours(projectActivities);
          const officialPlanned = Number(project.plannedHours || 0) > 0
            ? Number(project.plannedHours)
            : rawPlanned;
          const officialActual = Number(project.actualHours || 0) > 0
            ? Number(project.actualHours)
            : rawActual;
          totalPlannedHours += officialPlanned;
          totalActualHours += officialActual;
          const rawPlannedToDate = projectActivities.reduce((sum, activity) => {
            const start = toDate(activity.plannedStart) || toDate(activity.plannedEnd);
            const end = toDate(activity.plannedEnd) || start;
            const hours = Number(activity.plannedHours || 0);
            if (!asOfDate || !start || !end || asOfDate.getTime() <= start.getTime()) return sum;
            if (asOfDate.getTime() >= end.getTime()) return sum + hours;
            const duration = Math.max(1, end.getTime() - start.getTime());
            return sum + hours * Math.max(0, Math.min(1, (asOfDate.getTime() - start.getTime()) / duration));
          }, 0);
          const rawActualToDate = sumCanonicalActualHours(projectActivities.filter((activity) => {
            const start = toDate(activity.plannedStart) || toDate(activity.plannedEnd) || toDate(project.startDate);
            return Boolean(start && asOfDate && start.getTime() <= asOfDate.getTime());
          }));
          plannedHoursToDate += rawPlannedToDate;
          actualHoursToDate += rawActualToDate;
        });
        return {
          totalPlannedHours: Number(totalPlannedHours.toFixed(1)),
          totalActualHours: Number(totalActualHours.toFixed(1)),
          plannedHoursToDate: Number(plannedHoursToDate.toFixed(1)),
          actualHoursToDate: Number(actualHoursToDate.toFixed(1)),
          periodEnd: input.periodEnd || new Date().toISOString().slice(0, 10),
        };
      }),

    getSCurve: scopedProcedure
      .input(z.object({
        projectId: z.number().int().positive(),
        moduleName: z.string().optional(),
        compareSnapshotId: z.number().int().positive().optional(),
      }))
      .query(async ({ input, ctx }) => {
        if (!ctx.scope.canAccessProject(input.projectId)) throw forbidProject();
        const [projects, allActivities, snapshots] = await Promise.all([
          getProjectsList(),
          getAllProjectActivities(),
          getSCurveSnapshots(input.projectId, input.moduleName),
        ]);
        const project = projects.find((item) => item.id === input.projectId);
        if (!project) {
          return {
            projectId: input.projectId,
            moduleName: input.moduleName || "todos",
            totalPlannedHours: 0,
            totalActualHours: 0,
            modules: [],
            points: [],
            snapshots: [],
            comparison: null,
          };
        }
        const projectActivities = allActivities.filter((activity) => activity.projectId === input.projectId);
        const modules = Array.from(new Set(projectActivities.map((activity) => activity.moduleName).filter(Boolean))).sort();
        const currentCurve = calculateSCurve(project, projectActivities, input.moduleName || "todos");
        const selectedSnapshot = input.compareSnapshotId
          ? snapshots.find((snap) => snap.id === input.compareSnapshotId)
          : snapshots.find((snap) => snap.isBaseline) || snapshots[0];
        const comparisonPoints = selectedSnapshot ? parseSnapshotPoints(selectedSnapshot.pointsJson) : [];
        const comparisonMap = new Map(comparisonPoints.map((point) => [point.date, point]));
        const pointsWithComparison = currentCurve.points.map((point) => {
          const compared = comparisonMap.get(point.date);
          return {
            ...point,
            baselinePlannedHours: compared ? compared.plannedHours : null,
            baselineActualHours: compared ? compared.actualHours : null,
          };
        });

        return {
          ...currentCurve,
          modules,
          points: pointsWithComparison,
          snapshots: snapshots.map((snap) => ({
            id: snap.id,
            snapshotMonth: snap.snapshotMonth,
            moduleName: snap.moduleName,
            snapshotName: snap.snapshotName,
            isBaseline: snap.isBaseline,
            totalPlannedHours: Number(snap.totalPlannedHours),
            totalActualHours: Number(snap.totalActualHours),
            createdAt: snap.createdAt,
          })),
          comparison: selectedSnapshot
            ? {
                id: selectedSnapshot.id,
                snapshotName: selectedSnapshot.snapshotName,
                snapshotMonth: selectedSnapshot.snapshotMonth,
                isBaseline: selectedSnapshot.isBaseline,
                totalPlannedHours: Number(selectedSnapshot.totalPlannedHours),
                totalActualHours: Number(selectedSnapshot.totalActualHours),
              }
            : null,
        };
      }),

    saveSCurveSnapshot: writerProcedure
      .input(z.object({
        projectId: z.number().int().positive(),
        snapshotMonth: z.string().regex(/^\d{4}-\d{2}$/),
        moduleName: z.string().default("todos"),
        snapshotName: z.string().min(3).max(160).optional(),
        isBaseline: z.boolean().default(false),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.scope.canAccessProject(input.projectId)) throw forbidProject();
        const [project, activities, existingSnapshots] = await Promise.all([
          getProjectById(input.projectId),
          getProjectActivities(input.projectId),
          getSCurveSnapshots(input.projectId, input.moduleName),
        ]);
        if (!project) throw new Error("Projeto não encontrado.");
        const curve = calculateSCurve(project, activities, input.moduleName);
        const hasBaseline = existingSnapshots.some((snap) => snap.isBaseline && snap.moduleName === input.moduleName);
        const isBaseline = input.isBaseline || (!hasBaseline && existingSnapshots.length === 0);
        const monthLabel = new Date(`${input.snapshotMonth}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const defaultName = isBaseline
          ? `Linha de Base — ${monthLabel} (${input.moduleName === "todos" ? "Geral" : input.moduleName})`
          : `Snapshot ${monthLabel} (${input.moduleName === "todos" ? "Geral" : input.moduleName})`;
        const snapshotName = input.snapshotName?.trim() || defaultName;
        await createSCurveSnapshot({
          projectId: input.projectId,
          snapshotMonth: input.snapshotMonth,
          moduleName: input.moduleName,
          snapshotName,
          isBaseline,
          totalPlannedHours: curve.totalPlannedHours.toFixed(1),
          totalActualHours: curve.totalActualHours.toFixed(1),
          pointsJson: JSON.stringify(curve.points),
        });
        return {
          success: true,
          snapshotName,
          isBaseline,
        };
      }),

    getOracleConfig: adminProcedure.query(async () => {
      return await getOracleConfig();
    }),

    saveOracleConfig: adminProcedure
      .input(
        z.object({
          endpointUrl: z.string().min(5),
          syncIntervalMinutes: z.number().int().min(15).max(1440),
          backgroundEnabled: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        return await saveOracleConfig(input);
      }),

    testOracleConnection: adminProcedure
      .input(
        z.object({
          endpointUrl: z.string().optional(),
        }).optional()
      )
      .mutation(async ({ input }) => {
        return await testOracleConnection(input?.endpointUrl);
      }),

    publishOraclePreview: adminProcedure
      .input(
        z.object({
          endpointUrl: z.string().optional(),
          fileIdentifier: z.string().optional(),
          responsible: z.string().optional(),
          rowsCount: z.number().optional(),
          projectCount: z.number().int().nonnegative().optional(),
          stagingSessionId: z.string().uuid().optional(),
        }).optional()
      )
      .mutation(async ({ input }) => {
        return await publishAnalyzedPreview(input);
      }),

    getOracleSyncRunStatus: adminProcedure
      .input(z.object({ runId: z.number().int().positive() }))
      .query(async ({ input }) => {
        return await getOracleSyncRunStatus(input.runId);
      }),

    listOracleSyncRuns: adminProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(5).max(50).default(10),
        }).default({ page: 1, pageSize: 10 })
      )
      .query(async ({ input }) => {
        return await listOracleSyncRuns(input.page, input.pageSize);
      }),

    rollbackOracleSyncRun: adminProcedure
      .input(
        z.object({
          runId: z.number().int().positive(),
        })
      )
      .mutation(async ({ input }) => {
        return await rollbackOracleSyncRun(input.runId);
      }),

    importSpreadsheetRowsChunked: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          notes: z.string().optional(),
          rows: z.array(z.record(z.string(), z.any())),
        })
      )
      .mutation(async ({ input }) => {
        return await processParsedSpreadsheetRows(input.fileName, input.rows, input.notes);
      }),

    beginSpreadsheetImport: adminProcedure
      .input(
        z.object({
          fileName: z.string(),
          notes: z.string().optional(),
          totalChunks: z.number().int().min(1).max(2000),
          totalRows: z.number().int().min(1).max(100000),
        })
      )
      .mutation(async ({ input }) => {
        return await createSpreadsheetImportSession(input);
      }),

    uploadSpreadsheetImportChunk: adminProcedure
      .input(
        z.object({
          sessionId: z.string().uuid(),
          chunkIndex: z.number().int().min(0).max(1999),
          rows: z.array(z.record(z.string(), z.any())).min(1).max(1000),
        })
      )
      .mutation(async ({ input }) => {
        return await appendSpreadsheetImportChunk(input);
      }),

    completeSpreadsheetImport: adminProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const staged = await takeSpreadsheetImportSession(input.sessionId);
        return await processParsedSpreadsheetRows(staged.fileName, staged.rows, staged.notes);
      }),

    startProcessingSpreadsheetImport: adminProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        return await startProcessingSpreadsheetImportSession(input.sessionId);
      }),

    getSpreadsheetImportStatus: adminProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .query(async ({ input }) => {
        return await getSpreadsheetImportSessionStatus(input.sessionId);
      }),

    getProgressHistory: scopedProcedure
      .input(z.object({ projectIds: z.array(z.number().int().positive()).min(1).max(1000) }))
      .query(async ({ input, ctx }) => {
        const [allProjects, allActivities, allUpdates] = await Promise.all([
          getProjectsList(),
          getAllProjectActivities(),
          getProjectWeeklyUpdates(),
        ]);
        const projectIdSet = new Set(ctx.scope.filterProjectIds(input.projectIds));
        const projects = allProjects.filter((project) => projectIdSet.has(project.id));
        const activitiesByProject = new Map<number, typeof allActivities>();
        allActivities.forEach((activity) => {
          if (!projectIdSet.has(activity.projectId)) return;
          activitiesByProject.set(activity.projectId, [...(activitiesByProject.get(activity.projectId) || []), activity]);
        });

        const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
        const startOfMonday = (value: Date) => {
          const date = startOfDay(value);
          date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
          return date;
        };
        const toDate = (value: unknown) => {
          if (!value || String(value) === "Sem data") return null;
          const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
        };
        const formatDate = (value: Date) => `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}`;
        const parseUpdateDate = (reference: string) => {
          const text = String(reference || "");
          const rangeMatch = text.match(/\((\d{1,2})[\/-](\d{1,2})(?:\s*a\s*|\s*[–-]\s*)\d{1,2}[\/-]\d{1,2}\)\s*$/i);
          const weekMatch = text.match(/semana\s+(\d{1,2})\s*\/\s*((?:19|20)\d{2})/i);
          const fullDateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-]((?:19|20)\d{2})\b/);

          if (rangeMatch && weekMatch) {
            const date = new Date(Number(weekMatch[2]), Number(rangeMatch[2]) - 1, Number(rangeMatch[1]));
            return Number.isNaN(date.getTime()) ? null : startOfDay(date);
          }
          if (weekMatch) {
            const year = Number(weekMatch[2]);
            const week = Number(weekMatch[1]);
            const januaryFourth = startOfDay(new Date(year, 0, 4));
            const firstIsoMonday = startOfMonday(januaryFourth);
            return startOfDay(new Date(firstIsoMonday.getTime() + (week - 1) * 7 * 86400000));
          }
          if (fullDateMatch) {
            const date = new Date(Number(fullDateMatch[3]), Number(fullDateMatch[2]) - 1, Number(fullDateMatch[1]));
            return Number.isNaN(date.getTime()) ? null : startOfDay(date);
          }
          // createdAt registra o momento do salvamento, não a semana do
          // apontamento. Sem uma referência temporal explícita, o check-in
          // não pode ser posicionado na série sem inventar histórico.
          return null;
        };
        const progressAtDate = (activity: (typeof allActivities)[number], date: Date) => {
          const startDate = toDate(activity.plannedStart);
          const endDate = toDate(activity.plannedEnd) || startDate;
          if (!startDate || !endDate) return 0;
          if (date.getTime() <= startDate.getTime()) return 0;
          if (date.getTime() >= endDate.getTime()) return 1;
          const duration = Math.max(1, endDate.getTime() - startDate.getTime());
          return Math.max(0, Math.min(1, (date.getTime() - startDate.getTime()) / duration));
        };
        const currentMonday = startOfMonday(new Date());
        const latestWeeklyHoursByProjectWeek = new Map<string, { projectId: number; weekStart: Date; hours: number }>();
        const checkinWeekKeys = new Set<string>();
        // Horas realizadas só entram na série histórica quando a origem informa
        // explicitamente a semana do apontamento. O total consolidado da API e
        // as datas planejadas das atividades não podem ser distribuídos para
        // trás como se fossem apontamentos diários.
        allUpdates
          .slice()
          .sort((left, right) => Number(right.id) - Number(left.id))
          .forEach((update) => {
            const updateDate = parseUpdateDate(update.weekReference);
            if (!updateDate || !projectIdSet.has(update.projectId)) return;
            const weekStart = startOfMonday(updateDate);
            const key = `${update.projectId}|${weekStart.toISOString().slice(0, 10)}`;
            checkinWeekKeys.add(key);
            if (latestWeeklyHoursByProjectWeek.has(key)) return;
            latestWeeklyHoursByProjectWeek.set(key, {
              projectId: update.projectId,
              weekStart,
              hours: Math.max(0, Number(update.hoursConsumedWeek || 0)),
            });
          });
        const explicitWeeklyHours = Array.from(latestWeeklyHoursByProjectWeek.values());

        return Array.from({ length: 8 }, (_, index) => {
          const weekStart = new Date(currentMonday.getTime() - (7 - index) * 7 * 86400000);
          const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
          let totalPlanned = 0;
          let scheduledEarned = 0;
          let realizedHoursFromWeeklyCheckins = 0;

          projects.forEach((project) => {
            const projectActivities = activitiesByProject.get(project.id) || [];
            const level1Activities = projectActivities.some((activity) => activity.level === 1)
              ? projectActivities.filter((activity) => activity.level === 1)
              : projectActivities;
            const rawPlanned = sumCanonicalPlannedHours(level1Activities);
            const projectPlanned = Number(project.plannedHours || 0) > 0
              ? Number(project.plannedHours)
              : rawPlanned;
            totalPlanned += projectPlanned;
            scheduledEarned += level1Activities.reduce((sum, activity) => sum + Number(activity.plannedHours || 0) * progressAtDate(activity, weekEnd), 0);
            realizedHoursFromWeeklyCheckins += explicitWeeklyHours
              .filter((entry) => entry.projectId === project.id && entry.weekStart <= weekEnd)
              .reduce((sum, entry) => sum + entry.hours, 0);
          });

          const hasTemporalActuals = explicitWeeklyHours.some((entry) => entry.weekStart <= weekEnd && entry.hours > 0);

          return {
            label: `${formatDate(weekStart)}–${formatDate(weekEnd)}`,
            startDate: weekStart.toISOString().slice(0, 10),
            endDate: weekEnd.toISOString().slice(0, 10),
            programado: Number((totalPlanned > 0 ? Math.min(100, (scheduledEarned / totalPlanned) * 100) : 0).toFixed(1)),
            realizado: hasTemporalActuals && totalPlanned > 0
              ? Number(Math.min(100, (realizedHoursFromWeeklyCheckins / totalPlanned) * 100).toFixed(1))
              : null,
            horasRealizadas: hasTemporalActuals ? Number(realizedHoursFromWeeklyCheckins.toFixed(1)) : null,
            fonteRealizado: hasTemporalActuals ? "checkin_semanal" : "sem_base_temporal",
            projetos: projects.length,
            checkins: projects.reduce((count, project) => count + Array.from(checkinWeekKeys).filter((key) => {
              const [projectId, date] = key.split("|");
              return Number(projectId) === project.id && date >= weekStart.toISOString().slice(0, 10) && date <= weekEnd.toISOString().slice(0, 10);
            }).length, 0),
          };
        });
      }),

    getUpcomingAlerts: scopedProcedure
      .input(z.object({ projectIds: z.array(z.number().int().positive()).min(1).max(1000) }))
      .query(async ({ input, ctx }) => {
        const [allProjects, allActivities] = await Promise.all([getProjectsList(), getAllProjectActivities()]);
        const projectIdSet = new Set(ctx.scope.filterProjectIds(input.projectIds));
        const projectsById = new Map(allProjects.filter((project) => projectIdSet.has(project.id)).map((project) => [project.id, project]));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const businessDaysUntil = (target: Date) => {
          const cursor = new Date(today);
          let businessDays = 0;
          while (cursor.getTime() < target.getTime()) {
            cursor.setDate(cursor.getDate() + 1);
            if (cursor.getDay() !== 0 && cursor.getDay() !== 6) businessDays += 1;
          }
          return businessDays;
        };
        const dateLabel = (value: string) => value.split("-").reverse().join("/");

        return allActivities
          .filter((activity) => projectIdSet.has(activity.projectId) && activity.level === 1 && activity.status !== "concluido" && Number(activity.progressPct || 0) < 100)
          .flatMap((activity) => {
            if (!activity.plannedEnd || activity.plannedEnd === "Sem data") return [];
            const plannedEnd = new Date(`${activity.plannedEnd}T00:00:00`);
            if (Number.isNaN(plannedEnd.getTime()) || plannedEnd < today) return [];
            const businessDaysRemaining = businessDaysUntil(plannedEnd);
            if (businessDaysRemaining > 7) return [];
            const project = projectsById.get(activity.projectId);
            if (!project) return [];
            return [{
              activityId: activity.id,
              projectId: project.id,
              projectCode: project.code,
              projectName: project.name,
              client: project.client,
              ppsaCode: activity.ppsaCode,
              description: activity.description,
              plannedEnd: activity.plannedEnd,
              plannedEndLabel: dateLabel(activity.plannedEnd),
              businessDaysRemaining,
              progressPct: Number(activity.progressPct || 0),
              status: activity.status,
            }];
          })
          .sort((left, right) => left.businessDaysRemaining - right.businessDaysRemaining || left.plannedEnd.localeCompare(right.plannedEnd));
      }),

    getAllOpenRisks: scopedProcedure.query(async ({ ctx }) => {
      return ctx.scope.filterByProject(await getAllOpenRisks());
    }),

    getAllActivities: scopedProcedure.query(async ({ ctx }) => {
      return ctx.scope.filterByProject(await getAllProjectActivities());
    }),

    getById: scopedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        if (!ctx.scope.canAccessProject(input.id)) throw forbidProject();
        const project = await getProjectById(input.id);
        if (!project) throw new Error("Projeto não encontrado");
        const activities = await getProjectActivities(input.id);
        const risks = await getProjectRisks(input.id);
        const weeklyUpdates = await getProjectWeeklyUpdates(input.id);
        const managementModuleSummary = buildManagementModuleSummary(activities, {
          plannedHours: Number(project.plannedHours || 0),
          actualHours: projectActualHours(project),
        });
        return {
          project,
          activities,
          risks,
          weeklyUpdates,
          managementModuleSummary,
        };
      }),

    getPortfolioMetrics: scopedProcedure.query(async ({ ctx }) => {
      const allProjects = ctx.scope.filterProjects(await getProjectsList());
      const openRisks = ctx.scope.filterByProject(await getAllOpenRisks());

      const totalProjects = allProjects.length;
      const countVerde = allProjects.filter(p => p.status === "verde").length;
      const countAmarelo = allProjects.filter(p => p.status === "amarelo").length;
      const countVermelho = allProjects.filter(p => p.status === "vermelho").length;
      const countSemClassificacao = allProjects.filter(p => p.status === "sem_classificacao").length;

      let sumBaselineHours = 0;
      let sumPlannedHours = 0;
      let sumActualHours = 0;
      let sumProgressWeighted = 0;

      for (const p of allProjects) {
        const planned = parseFloat(p.plannedHours || "0");
        const actual = projectActualHours(p);
        const baseline = parseFloat(p.baselineHours || "0");
        const progress = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;

        sumBaselineHours += baseline;
        sumPlannedHours += planned;
        sumActualHours += actual;
        sumProgressWeighted += progress * (planned > 0 ? planned : 1);
      }

      const avgProgress = sumPlannedHours > 0 ? (sumProgressWeighted / sumPlannedHours).toFixed(1) : "0.0";
      const hoursBurnRate = sumPlannedHours > 0 ? ((sumActualHours / sumPlannedHours) * 100).toFixed(1) : "0.0";

      return {
        totalProjects,
        countVerde,
        countAmarelo,
        countVermelho,
        countSemClassificacao,
        sumBaselineHours: sumBaselineHours.toFixed(1),
        sumPlannedHours: sumPlannedHours.toFixed(1),
        sumActualHours: sumActualHours.toFixed(1),
        avgProgress,
        hoursBurnRate,
        criticalRisksCount: openRisks.filter(r => r.severity === "critico").length,
        totalOpenRisks: openRisks.length,
      };
    }),

    getProjectWeeklyUpdates: scopedProcedure
      .input(z.object({ projectId: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        if (input?.projectId) {
          if (!ctx.scope.canAccessProject(input.projectId)) throw forbidProject();
          return await getProjectWeeklyUpdates(input.projectId);
        }
        return ctx.scope.filterByProject(await getProjectWeeklyUpdates());
      }),

    addWeeklyUpdate: writerProcedure
      .input(
        z.object({
          projectId: z.number(),
          weekReference: z.string(),
          authorName: z.string(),
          authorRole: z.string(),
          ragStatus: z.enum(["verde", "amarelo", "vermelho"]),
          physicalProgressPct: z.string(),
          spiValue: z.string(),
          cpiValue: z.string(),
          hoursConsumedWeek: z.string(),
          whatOccurred: z.string(),
          nextSteps: z.string(),
          criticalAttention: z.string().optional(),
          clientDecisionsNeeded: z.string().optional(),
          attachments: z.array(
            z.object({
              fileName: z.string(),
              fileBase64: z.string(),
              contentType: z.string().default("application/octet-stream"),
            })
          ).optional().default([]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!ctx.scope.canAccessProject(input.projectId)) throw forbidProject();
        const uploadedAttachments = [];
        for (const file of input.attachments) {
          const buffer = Buffer.from(file.fileBase64, "base64");
          const sanitizedName = file.fileName.replace(/[\\/]/g, "_").slice(0, 255);
          const relKey = `checkin-attachments/project-${input.projectId}/${sanitizedName}`;
          const uploaded = await storagePut(relKey, buffer, file.contentType || "application/octet-stream");
          uploadedAttachments.push({
            weeklyUpdateId: 0,
            fileName: sanitizedName,
            storageKey: uploaded.key,
            storageUrl: uploaded.url,
            contentType: file.contentType || "application/octet-stream",
            fileSize: buffer.length,
          });
        }
        await createWeeklyUpdate({
          projectId: input.projectId,
          weekReference: input.weekReference,
          authorName: input.authorName,
          authorRole: input.authorRole,
          ragStatus: input.ragStatus,
          physicalProgressPct: input.physicalProgressPct,
          spiValue: input.spiValue,
          cpiValue: input.cpiValue,
          hoursConsumedWeek: input.hoursConsumedWeek,
          whatOccurred: input.whatOccurred,
          nextSteps: input.nextSteps,
          criticalAttention: input.criticalAttention || "",
          clientDecisionsNeeded: input.clientDecisionsNeeded || "",
        }, uploadedAttachments);
        return { success: true };
      }),

    addRisk: writerProcedure
      .input(
        z.object({
          projectId: z.number(),
          title: z.string(),
          category: z.string(),
          severity: z.enum(["baixo", "medio", "alto", "critico"]),
          probability: z.enum(["baixo", "medio", "alto"]),
          impact: z.string(),
          mitigationPlan: z.string(),
          owner: z.string(),
          dueDate: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (!ctx.scope.canAccessProject(input.projectId)) throw forbidProject();
        await createProjectRisk({
          projectId: input.projectId,
          title: input.title,
          category: input.category,
          severity: input.severity,
          probability: input.probability,
          impact: input.impact,
          mitigationPlan: input.mitigationPlan,
          owner: input.owner,
          dueDate: input.dueDate || null,
          status: "aberto",
        });
        return { success: true };
      }),

    updateRiskStatus: writerProcedure
      .input(
        z.object({
          riskId: z.number(),
          status: z.enum(["aberto", "em_mitigacao", "resolvido"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const riskProjectId = await getRiskProjectId(input.riskId);
        if (riskProjectId === null || !ctx.scope.canAccessProject(riskProjectId)) throw forbidProject();
        await updateRiskStatus(input.riskId, input.status);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
