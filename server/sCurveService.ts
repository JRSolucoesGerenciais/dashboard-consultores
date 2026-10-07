import type { Project, ProjectActivity } from "../drizzle/schema";
import { sumCanonicalActualHours, sumCanonicalPlannedHours } from "@shared/hierarchyHours";

export type SCurvePoint = {
  date: string;
  label: string;
  plannedHours: number;
  actualHours: number;
  plannedPct: number;
  actualPct: number;
};

export type SCurveResult = {
  projectId: number;
  moduleName: string;
  totalPlannedHours: number;
  totalActualHours: number;
  points: SCurvePoint[];
};

function toDate(value: unknown): Date | null {
  if (!value || String(value) === "Sem data") return null;
  const text = String(value).slice(0, 10);
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonday(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function dateLabel(value: Date) {
  return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function calculateSCurve(
  project: Project,
  activities: ProjectActivity[],
  requestedModule = "todos",
): SCurveResult {
  const moduleName = requestedModule && requestedModule !== "todos" ? requestedModule : "todos";
  const moduleActivities = moduleName === "todos"
    ? activities
    : activities.filter((activity) => (activity.moduleName || "Sem módulo") === moduleName);
  const levelOne = moduleActivities.filter((activity) => activity.level === 1);
  const base = levelOne.length > 0 ? levelOne : moduleActivities;
  const projectStart = toDate(project.startDate);
  const projectEnd = toDate(project.plannedEndDate) || toDate(project.projectedEndDate) || toDate(project.finalDate);
  const activityDates = base
    .flatMap((activity) => [toDate(activity.plannedStart), toDate(activity.plannedEnd)])
    .filter((date): date is Date => Boolean(date));
  const firstDate = activityDates.length
    ? new Date(Math.min(...activityDates.map((date) => date.getTime())))
    : projectStart || new Date();
  const lastDate = activityDates.length
    ? new Date(Math.max(...activityDates.map((date) => date.getTime())))
    : projectEnd || firstDate;
  const start = startOfMonday(firstDate);
  const end = lastDate.getTime() < start.getTime() ? start : lastDate;
  const rawPlannedHours = sumCanonicalPlannedHours(base);
  const rawActualHours = sumCanonicalActualHours(base);
  const isWholeProject = moduleName === "todos";
  const totalPlannedHours = isWholeProject && Number(project.plannedHours || 0) > 0
    ? Number(project.plannedHours)
    : rawPlannedHours;
  const totalActualHours = isWholeProject && Number(project.actualHours || 0) > 0
    ? Number(project.actualHours)
    : rawActualHours;

  const progressAtDate = (activity: ProjectActivity, date: Date) => {
    const activityStart = toDate(activity.plannedStart) || toDate(activity.plannedEnd);
    const activityEnd = toDate(activity.plannedEnd) || activityStart;
    if (!activityStart || !activityEnd || date.getTime() <= activityStart.getTime()) return 0;
    if (date.getTime() >= activityEnd.getTime()) return 1;
    return Math.max(0, Math.min(1, (date.getTime() - activityStart.getTime()) / Math.max(1, activityEnd.getTime() - activityStart.getTime())));
  };

  const points: SCurvePoint[] = [];
  for (let index = 0; index < 260; index += 1) {
    const cursor = new Date(start.getTime() + index * 7 * 86_400_000);
    if (cursor.getTime() > end.getTime()) break;
    const plannedHours = base.reduce((sum, activity) => sum + Number(activity.plannedHours || 0) * progressAtDate(activity, cursor), 0);
    const rawActualToDate = sumCanonicalActualHours(base.filter((activity) => {
      const activityStart = toDate(activity.plannedStart) || toDate(activity.plannedEnd) || projectStart;
      return Boolean(activityStart && activityStart.getTime() <= cursor.getTime());
    }));
    const actualHours = rawActualToDate;
    points.push({
      date: cursor.toISOString().slice(0, 10),
      label: dateLabel(cursor),
      plannedHours: Number(plannedHours.toFixed(1)),
      actualHours: Number(actualHours.toFixed(1)),
      plannedPct: Number((totalPlannedHours > 0 ? Math.min(100, plannedHours / totalPlannedHours * 100) : 0).toFixed(1)),
      actualPct: Number((totalPlannedHours > 0 ? Math.min(100, actualHours / totalPlannedHours * 100) : 0).toFixed(1)),
    });
  }

  return {
    projectId: project.id,
    moduleName,
    totalPlannedHours: Number(totalPlannedHours.toFixed(1)),
    totalActualHours: Number(totalActualHours.toFixed(1)),
    points,
  };
}

export function parseSnapshotPoints(value: string | null | undefined): SCurvePoint[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as SCurvePoint[] : [];
  } catch {
    return [];
  }
}
