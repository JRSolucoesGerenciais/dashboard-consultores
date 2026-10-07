import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger } from "@/components/ui/tooltip";
import { currentDateIso, matchesProjectDateRange, sameFilterValue, useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Download,
  Flag,
  FileText,
  Folder,
  FolderOpen,
  History,
  Info,
  Layers,
  ListTree,
  MinusCircle,
  PlusCircle,
  Search,
  ShieldAlert,
  Target,
  Users,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { jsPDF } from "jspdf";
import { SCurveSection } from "@/components/SCurveSection";
import { hasManagedProductivityMetrics, hasOfficialHoursMetrics } from "@/lib/hoursMetrics";
import { sumCanonicalActualHours, sumCanonicalPlannedHours } from "@shared/hierarchyHours";

type ActivityRow = {
  id: number;
  ppsaCode: string;
  description: string;
  process: string;
  subprocess: string;
  managementName: string | null;
  moduleName: string;
  resource: string | null;
  plannedHours: string;
  actualHours: string;
  progressPct: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string | null;
  actualEnd?: string | null;
  level: number;
  levelParent?: string | null;
  parentPpsaId?: number | null;
  sourcePpsaId?: number | null;
  plannedActivityHours?: string | number | null;
  actualAtomicHours?: string | number | null;
  actualConsolidatedHours?: string | number | null;
  sourceRecordType?: string | null;
  status: string;
  hoursCompletionPct?: string | number | null;
  hoursOverrunStatus?: string | null;
  sourceStatus?: string | null;
  moduleActualEndDate?: string | null;
  sourceCronogramId?: number | null;
  standardDuration?: string | null;
  plannedDays?: string | number | null;
  plannedWeeks?: string | number | null;
};

type SCurvePoint = {
  date: string;
  label: string;
  plannedHours: number;
  actualHours: number;
  plannedPct: number;
  actualPct: number;
};

function numberBR(value: unknown, decimals = 0) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dateBR(value: string | null | undefined) {
  if (!value || value === "Sem data") return "Sem data";
  const parts = value.split("-");
  return parts.length === 3 ? parts.reverse().join("/") : value;
}

function remainingDays(value: string | null | undefined, isCompleted = false) {
  if (isCompleted) return { label: "", className: "" };
  if (!value || value === "Sem data") return { label: "Sem prazo", className: "text-slate-400" };
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return { label: "Sem prazo", className: "text-slate-400" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `Atrasada há ${numberBR(Math.abs(days))} ${Math.abs(days) === 1 ? "dia" : "dias"}`, className: "text-rose-700 font-semibold" };
  if (days === 0) return { label: "Vence hoje", className: "text-rose-700 font-semibold" };
  if (days <= 7) return { label: `Faltam ${numberBR(days)} ${days === 1 ? "dia" : "dias"}`, className: "text-amber-700 font-semibold" };
  return { label: `Faltam ${numberBR(days)} dias`, className: "text-slate-500" };
}

function statusLabel(status: string) {
  if (status === "concluido") return "Concluída";
  if (status === "atrasado") return "Atrasada";
  if (status === "atencao" || status === "amarelo") return "Atenção";
  if (status === "em_andamento") return "Em andamento";
  return "Não iniciado";
}

function statusClass(status: string) {
  if (status === "concluido") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "atrasado") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "atencao" || status === "amarelo") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "em_andamento") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusDotClass(status: string) {
  if (status === "concluido") return "bg-emerald-600";
  if (status === "atrasado") return "bg-red-600";
  if (status === "atencao" || status === "amarelo") return "bg-amber-500";
  if (status === "em_andamento") return "bg-blue-600";
  return "bg-slate-500";
}

function isLateActivity(activity: ActivityRow) {
  if (activity.status === "concluido") return false;
  if (!activity.plannedEnd || activity.plannedEnd === "Sem data") return activity.status === "atrasado";
  const end = new Date(`${activity.plannedEnd}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today && Number(activity.progressPct || 0) < 100;
}

function isCompletedActivity(activity: Pick<ActivityRow, "status" | "sourceStatus" | "progressPct">) {
  return activity.status === "concluido"
    || activity.sourceStatus === "CONCLUIDA"
    || activity.sourceStatus === "CONCLUÍDA"
    || Number(activity.progressPct || 0) >= 100;
}

function isCompletedLevel1Milestone(activity: Pick<ActivityRow, "level" | "status" | "sourceStatus" | "progressPct">) {
  return activity.level === 1 && isCompletedActivity(activity);
}

function ppsaRowClass(level: number, status: string, isMilestone = false) {
  if (status === "atrasado") return "bg-rose-100 hover:bg-rose-200 border-b-rose-200 border-l-4 border-l-red-600";
  if (status === "atencao" || status === "amarelo") return "bg-amber-100 hover:bg-amber-200 border-b-amber-200 border-l-4 border-l-amber-500";
  if (isMilestone) return "bg-fuchsia-100 hover:bg-fuchsia-200 border-b-fuchsia-200 border-l-4 border-l-fuchsia-700 ring-1 ring-inset ring-fuchsia-200";
  if (level === 1) return "bg-sky-100 hover:bg-sky-200 border-b-sky-200 border-l-4 border-l-blue-700";
  if (level === 2) return "bg-violet-100 hover:bg-violet-200 border-b-violet-200 border-l-4 border-l-violet-600";
  return "bg-emerald-50 hover:bg-emerald-100 border-b-emerald-100 border-l-4 border-l-emerald-500";
}

function ppsaLevelBadgeClass(level: number) {
  if (level === 1) return "border-blue-500 bg-sky-200 text-blue-950 font-bold";
  if (level === 2) return "border-violet-500 bg-violet-200 text-violet-950 font-semibold";
  return "border-emerald-500 bg-emerald-100 text-emerald-900 font-semibold";
}

function ppsaParent(code: string) {
  const parts = code.split(".");
  let lastNonZero = -1;
  parts.forEach((part, index) => {
    if (Number(part) !== 0) lastNonZero = index;
  });
  if (lastNonZero <= 0) return null;
  for (let index = lastNonZero; index < parts.length; index += 1) parts[index] = "0";
  return parts.join(".");
}

function activityParent(activity: ActivityRow) {
  if (activity.parentPpsaId) {
    return `ID_${activity.parentPpsaId}`;
  }
  if (activity.levelParent) {
    return activity.levelParent;
  }
  return ppsaParent(activity.ppsaCode);
}

function comparePpsa(a: ActivityRow, b: ActivityRow) {
  const left = a.ppsaCode.split(".").map((part) => Number(part) || 0);
  const right = b.ppsaCode.split(".").map((part) => Number(part) || 0);
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return a.level - b.level || a.id - b.id;
}

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { projectFilter, setProjectFilter, setDateStart, setDateEnd, activeFilter, clientFilter, sponsorFilter, typeFilter, dateStart, dateEnd } = useGlobalFilters();
  const { data: allProjects = [], isLoading: projectsLoading } = trpc.projects.list.useQuery();

  const globallyFilteredProjects = useMemo(() => allProjects.filter((candidate) => {
    if (activeFilter === "ativo" && !candidate.isActive) return false;
    if (activeFilter === "inativo" && candidate.isActive) return false;
    if (clientFilter !== "todos" && !sameFilterValue(candidate.client, clientFilter)) return false;
    if (sponsorFilter !== "todos" && !sameFilterValue(candidate.sponsor || "Não informado", sponsorFilter)) return false;
    if (typeFilter !== "todos" && !sameFilterValue(candidate.projectTypeDescription || candidate.projectType || "Não informado", typeFilter)) return false;
    return matchesProjectDateRange(candidate, dateStart, dateEnd);
  }), [allProjects, activeFilter, clientFilter, sponsorFilter, typeFilter, dateStart, dateEnd]);

  const effectiveProjectId = useMemo(() => {
    if (params.id) {
      const routeProject = globallyFilteredProjects.find((candidate) => String(candidate.id) === params.id || candidate.code === params.id);
      if (routeProject) return routeProject.id;
    }
    if (projectFilter !== "todos") {
      const parsed = Number(projectFilter);
      if (Number.isFinite(parsed) && globallyFilteredProjects.some((candidate) => candidate.id === parsed)) return parsed;
      const found = globallyFilteredProjects.find((p) => p.code === projectFilter);
      if (found) return found.id;
    }
    return globallyFilteredProjects[0]?.id;
  }, [params.id, projectFilter, globallyFilteredProjects, allProjects]);

  const { data, isLoading } = trpc.projects.getById.useQuery(
    { id: effectiveProjectId ?? 0 },
    { enabled: Boolean(effectiveProjectId) }
  );

  useEffect(() => {
    const routeProject = params.id ? globallyFilteredProjects.find((candidate) => String(candidate.id) === params.id || candidate.code === params.id) : null;
    if (params.id && effectiveProjectId && routeProject) {
      setProjectFilter(String(effectiveProjectId));
      if (routeProject.startDate && routeProject.startDate !== "Sem data") setDateStart(routeProject.startDate);
      setDateEnd(currentDateIso());
    }
  }, [params.id, effectiveProjectId, globallyFilteredProjects, setProjectFilter, setDateStart, setDateEnd]);

  const [visibleLevel, setVisibleLevel] = useState(3);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [areaFilter, setAreaFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [scheduleFilter, setScheduleFilter] = useState<"todos" | "cronograma" | "avulsos">("todos");
  const [onlyOverrun, setOnlyOverrun] = useState(false);
  const [sortMode, setSortMode] = useState<"ppsa" | "endAsc">("ppsa");
  const [selectedPhysicalMetric, setSelectedPhysicalMetric] = useState<"calculado" | "informado" | "programado">("calculado");
  const [expandedManagementModules, setExpandedManagementModules] = useState<Set<string>>(new Set());

  const project = data?.project;
  const activities = useMemo(
    () => ([...(data?.activities || [])] as ActivityRow[]).sort(comparePpsa),
    [data?.activities],
  );
  const risks = data?.risks || [];
  const weeklyUpdates = data?.weeklyUpdates || [];
  const managementModuleSummary = data?.managementModuleSummary || [];

  const maxLevel = Math.max(1, ...activities.map((activity) => activity.level || 1));
  const levelOptions = Array.from({ length: Math.min(maxLevel, 3) }, (_, index) => index + 1);
  const areas = Array.from(new Set(activities.map((activity) => activity.moduleName || "Sem área"))).sort();
  const statuses = Array.from(new Set(activities.map((activity) => activity.status))).sort();
  const statusLegend = ["concluido", "em_andamento", "atencao", "amarelo", "atrasado", "nao_iniciado"].filter((status, index, values) => statuses.includes(status) && values.indexOf(status) === index);
  const milestoneCount = useMemo(
    () => activities.filter((activity) => isCompletedLevel1Milestone(activity)).length,
    [activities],
  );

  const sortedActivities = useMemo(() => {
    if (sortMode === "ppsa") return activities;
    return [...activities].sort((left, right) => {
      const leftDate = left.plannedEnd && left.plannedEnd !== "Sem data" ? left.plannedEnd : "9999-12-31";
      const rightDate = right.plannedEnd && right.plannedEnd !== "Sem data" ? right.plannedEnd : "9999-12-31";
      return leftDate.localeCompare(rightDate) || comparePpsa(left, right);
    });
  }, [activities, sortMode]);

  const filteredActivities = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return sortedActivities.filter((activity) => {
      if (activity.level > visibleLevel) return false;
      if (allCollapsed && activity.level > 1) return false;
      if (areaFilter !== "todos" && activity.moduleName !== areaFilter) return false;
      if (statusFilter !== "todos" && activity.status !== statusFilter) return false;
      if (scheduleFilter === "cronograma" && activity.sourceCronogramId == null) return false;
      if (scheduleFilter === "avulsos" && activity.sourceCronogramId != null) return false;
      if (onlyOverrun && Number(activity.plannedHours || 0) - Number(activity.actualHours || 0) >= 0) return false;
      if (query && ![activity.ppsaCode, activity.description, activity.process, activity.subprocess, activity.managementName, activity.moduleName, activity.resource]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query))) return false;
      return true;
    });
  }, [sortedActivities, visibleLevel, areaFilter, statusFilter, scheduleFilter, searchTerm, allCollapsed, onlyOverrun]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    activities.forEach((activity) => {
      const parent = activityParent(activity);
      if (!parent) return;
      const current = map.get(parent) || [];
      current.push(activity);
      map.set(parent, current);
    });
    return map;
  }, [activities]);

  const visibleActivities = useMemo(() => {
    const result: ActivityRow[] = [];
    const isHiddenByCollapsedParent = (activity: ActivityRow) => {
      let parent = activityParent(activity);
      while (parent) {
        if (collapsed.has(parent)) return true;
        const parentActivity = activities.find((candidate) => candidate.ppsaCode === parent);
        parent = parentActivity ? activityParent(parentActivity) : null;
      }
      return false;
    };
    filteredActivities.forEach((activity) => {
      if (!isHiddenByCollapsedParent(activity)) result.push(activity);
    });
    return result;
  }, [filteredActivities, collapsed]);

  const stats = useMemo(() => {
    const total = activities.length;
    const done = activities.filter((a) => a.status === "concluido").length;
    const running = activities.filter((a) => a.status === "em_andamento").length;
    const late = activities.filter(isLateActivity).length;
    const notStarted = activities.filter((a) => a.status === "nao_iniciado").length;
    const progress = total ? activities.reduce((sum, a) => sum + Number(a.progressPct || 0), 0) / total : Number(project?.completionPct || 0);
    return { total, done, running, late, notStarted, progress };
  }, [activities, project?.completionPct]);

  const physicalMetrics = useMemo(() => {
    const level1 = activities.filter((activity) => activity.level === 1);
    const base = level1.length > 0 ? level1 : activities;
    const plannedHours = project ? Number(project.plannedHours || 0) : base.reduce((sum, activity) => sum + Number(activity.plannedHours || 0), 0);
    const actualHours = project ? Number(project.actualHours || 0) : base.reduce((sum, activity) => sum + Number(activity.actualHours || 0), 0);
    const periodEnd = dateEnd && dateEnd !== "Sem data" ? new Date(`${dateEnd}T00:00:00`) : new Date();
    periodEnd.setHours(0, 0, 0, 0);
    const plannedHoursToDate = base.reduce((sum, activity) => {
      const start = activity.plannedStart && activity.plannedStart !== "Sem data" ? new Date(`${activity.plannedStart}T00:00:00`) : null;
      const end = activity.plannedEnd && activity.plannedEnd !== "Sem data" ? new Date(`${activity.plannedEnd}T00:00:00`) : start;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || periodEnd.getTime() <= start.getTime()) return sum;
      const hours = Number(activity.plannedHours || 0);
      if (periodEnd.getTime() >= end.getTime()) return sum + hours;
      const duration = Math.max(1, end.getTime() - start.getTime());
      return sum + hours * Math.max(0, Math.min(1, (periodEnd.getTime() - start.getTime()) / duration));
    }, 0);
    const actualHoursToDate = sumCanonicalActualHours(base.filter((activity) => {
      const start = activity.plannedStart && activity.plannedStart !== "Sem data"
        ? new Date(`${activity.plannedStart}T00:00:00`)
        : activity.plannedEnd && activity.plannedEnd !== "Sem data" ? new Date(`${activity.plannedEnd}T00:00:00`) : null;
      return Boolean(start && !Number.isNaN(start.getTime()) && start.getTime() <= periodEnd.getTime());
    }));
    const hoursProgress = plannedHours > 0 ? Math.min(100, (actualHours / plannedHours) * 100) : 0;
    const latestUpdate = [...weeklyUpdates].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || ""))).at(-1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Avanço físico por atividade concluída: percentual médio de conclusão das atividades
    const completedActivities = activities.filter((activity) => activity.status === "concluido").length;
    const physicalActivitiesProgress = activities.length > 0
      ? Number((activities.reduce((sum, a) => sum + Number(a.progressPct || 0), 0) / activities.length).toFixed(1))
      : Number(project?.completionPct || 0);
    const programmedHours = base.reduce((sum, activity) => {
      const start = activity.plannedStart && activity.plannedStart !== "Sem data" ? new Date(`${activity.plannedStart}T00:00:00`) : null;
      const end = activity.plannedEnd && activity.plannedEnd !== "Sem data" ? new Date(`${activity.plannedEnd}T00:00:00`) : start;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return sum;
      if (today <= start) return sum;
      if (today >= end) return sum + Number(activity.plannedHours || 0);
      const duration = Math.max(1, end.getTime() - start.getTime());
      return sum + Number(activity.plannedHours || 0) * Math.max(0, Math.min(1, (today.getTime() - start.getTime()) / duration));
    }, 0);
    const programmedProgress = plannedHours > 0 ? Math.min(100, (programmedHours / plannedHours) * 100) : 0;
    const hasCheckin = Boolean(latestUpdate);
    const informedProgress = hasCheckin ? Number(latestUpdate?.physicalProgressPct || 0) : 0;
    return {
      plannedHours,
      actualHours,
      plannedHoursToDate,
      actualHoursToDate,
      periodEnd: dateEnd || new Date().toISOString().slice(0, 10),
      hoursProgress,
      informedProgress,
      programmedProgress,
      physicalActivitiesProgress,
      completedActivities,
      chart: weeklyUpdates.length > 0
        ? [...weeklyUpdates].reverse().map((update) => ({ name: update.weekReference.replace(/\s*\/\s*\d{4}.*/, ""), programado: programmedProgress, calculado: hoursProgress, informado: Number(update.physicalProgressPct || 0) }))
        : [{ name: "Atual", programado: programmedProgress, calculado: hoursProgress, informado: 0 }],
    };
  }, [activities, weeklyUpdates, dateEnd]);

  const scheduleScopeMetrics = useMemo(() => {
    const level1 = activities.filter((activity) => activity.level === 1);
    const base = level1.length > 0 ? level1 : activities;
    const inSchedule = base.filter((activity) => activity.sourceCronogramId != null);
    const outsideSchedule = base.filter((activity) => activity.sourceCronogramId == null);
    const summarize = (items: ActivityRow[]) => {
      const planned = sumCanonicalPlannedHours(items);
      const actual = sumCanonicalActualHours(items);
      return { planned, actual, balance: planned - actual, count: items.length };
    };
    const inScheduleCalc = summarize(inSchedule);
    const outsideScheduleCalc = summarize(outsideSchedule);
    const totalCalc = summarize(base);
    const projectPlanned = project ? Number(project.plannedHours || 0) : 0;
    const projectActual = project ? Number(project.actualHours || 0) : 0;
    const plannedInSchedule = project?.plannedHoursInSchedule != null
      ? Number(project.plannedHoursInSchedule)
      : inScheduleCalc.planned;
    const plannedOutsideSchedule = project?.plannedHoursOutsideSchedule != null
      ? Number(project.plannedHoursOutsideSchedule)
      : outsideScheduleCalc.planned;

    return {
      inSchedule: { ...inScheduleCalc, planned: plannedInSchedule },
      outsideSchedule: { ...outsideScheduleCalc, planned: plannedOutsideSchedule },
      total: {
        ...totalCalc,
        planned: projectPlanned > 0 ? projectPlanned : totalCalc.planned,
        actual: projectActual > 0 ? projectActual : totalCalc.actual,
      },
      productiveActual: inScheduleCalc.actual,
      unproductiveActual: outsideScheduleCalc.actual,
    };
  }, [activities, project]);

  const managementOverview = useMemo(() => {
    const managementCount = new Set(managementModuleSummary.map((item) => item.managementKey)).size;
    const moduleCount = new Set(managementModuleSummary.map((item) => `${item.managementKey}|${item.moduleKey}`)).size;
    const pendingActivities = activities.filter((activity) => activity.level === 1 && activity.status !== "concluido").length;
    const balance = Number((scheduleScopeMetrics.total.planned - scheduleScopeMetrics.total.actual).toFixed(2));
    const completionPct = scheduleScopeMetrics.total.planned > 0
      ? Number(((scheduleScopeMetrics.total.actual / scheduleScopeMetrics.total.planned) * 100).toFixed(2))
      : 0;
    return { managementCount, moduleCount, pendingActivities, balance, completionPct };
  }, [activities, managementModuleSummary, scheduleScopeMetrics.total]);

  const productivityDeviation = useMemo(() => {
    const productive = Number(scheduleScopeMetrics.productiveActual || 0);
    const unproductive = Number(scheduleScopeMetrics.unproductiveActual || 0);
    const totalReported = productive + unproductive;
    const unproductivePct = totalReported > 0 ? (unproductive / totalReported) * 100 : 0;
    return {
      productive,
      unproductive,
      totalReported,
      unproductivePct,
      exceedsThreshold: unproductivePct > 30,
    };
  }, [scheduleScopeMetrics.productiveActual, scheduleScopeMetrics.unproductiveActual]);

  const periodHoursBalance = physicalMetrics.plannedHoursToDate - physicalMetrics.actualHoursToDate;

  const physicalActivities = useMemo(() => {
    const level1 = activities.filter((activity) => activity.level === 1);
    const base = level1.length > 0 ? level1 : activities;
    if (selectedPhysicalMetric === "calculado") return base.filter((activity) => Number(activity.actualHours || 0) > 0);
    if (selectedPhysicalMetric === "programado") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return base.filter((activity) => {
        const start = activity.plannedStart && activity.plannedStart !== "Sem data" ? new Date(`${activity.plannedStart}T00:00:00`) : null;
        return Boolean(start && start <= today);
      });
    }
    return base;
  }, [activities, selectedPhysicalMetric]);

  const compositionTotals = useMemo(() => {
    // managementModuleSummary agora já entrega uma linha por Gestão/Módulo oficial.
    // O rodapé soma exatamente essas linhas distintas sem misturar N1, N2 e N3.
    const planned = managementModuleSummary.reduce((sum, item) => sum + item.plannedHours, 0);
    const actual = managementModuleSummary.reduce((sum, item) => sum + item.actualHours, 0);
    const balance = Number((planned - actual).toFixed(2));
    const completionPct = planned > 0 ? (actual / planned) * 100 : 0;
    const officialWeeks = managementModuleSummary.filter((item) => item.plannedWeeks != null);
    const plannedWeeks = officialWeeks.length > 0
      ? officialWeeks.reduce((sum, item) => sum + Number(item.plannedWeeks || 0), 0)
      : null;
    return { planned, actual, balance, completionPct, plannedWeeks };
  }, [managementModuleSummary]);

  const hoursTotals = useMemo(() => {
    const level1Activities = visibleActivities.filter((activity) => activity.level === 1);
    const planned = sumCanonicalPlannedHours(level1Activities);
    const actual = sumCanonicalActualHours(level1Activities);
    return {
      planned,
      actual,
      balance: planned - actual,
      overrunCount: level1Activities.filter((activity) => Number(activity.plannedHours || 0) - Number(activity.actualHours || 0) < 0).length,
    };
  }, [visibleActivities]);

  const allExpandableKeys = useMemo(
    () => Array.from(childrenByParent.keys()).filter((key) => activities.some((activity) => activity.ppsaCode === key)),
    [childrenByParent, activities]
  );

  if (isLoading || projectsLoading) {
    return <div className="py-12 text-center text-sm text-slate-500">Carregando informações do projeto...</div>;
  }
  if (!globallyFilteredProjects.length) {
    return (
      <div className="space-y-5">
        <GlobalFilterBar showProjectSelector />
        <Card><CardContent className="py-14 text-center"><h2 className="text-lg font-bold text-slate-800">Nenhum projeto atende aos filtros globais</h2><p className="text-sm text-slate-500 mt-2">Ajuste Cliente, Projeto Ativo, Gestor, Tipo ou as datas e clique em Filtrar.</p></CardContent></Card>
      </div>
    );
  }
  if (!effectiveProjectId) {
    return <div className="py-12 text-center text-sm text-slate-500">Selecione um projeto para visualizar o detalhe.</div>;
  }
  if (!project) {
    return (
      <div className="py-12 text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-800">Projeto não encontrado</h2>
        <Link href="/"><Button variant="outline">Voltar para o Portfólio</Button></Link>
      </div>
    );
  }

  const metricsSource = String((project as any).hoursMetricsSource || "");
  const usesLegacySql = metricsSource.includes("SQL_REV02");
  const usesRevAtual = metricsSource.includes("SQL_REV_ATUAL");
  const usesRev06View = metricsSource.includes("SQL_REV06");
  const productivityIsOfficial = hasOfficialHoursMetrics(project);
  const productivityIsManaged = hasManagedProductivityMetrics(project);
  const sourceLabel = activities.length > 0
    ? `Fonte: ${usesRevAtual ? "SQL RevAtual — valores recebidos da API" : usesRev06View ? "View REV06 — valores recebidos da API" : usesLegacySql ? "SQL anterior — valores recebidos da API" : "planilha/API"} • ${activities.length} atividades`
    : "Fonte: cadastro mestre • sem programação operacional";

  const toggleNode = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const plannedProjectEnd = dateBR(project.plannedEndDate);
  const finalDate = dateBR(project.finalDate);
  const currentStatusLabel = project.status === "verde"
    ? "No prazo"
    : project.status === "amarelo"
      ? "Atenção"
      : project.status === "vermelho"
        ? "Crítico"
        : stats.late > 0
          ? "Atenção — há atividades atrasadas"
          : stats.running > 0
            ? "Em andamento"
            : stats.done === stats.total && stats.total > 0
              ? "Concluído"
              : "Não iniciado";
  const currentStatusCode = project.status === "sem_classificacao"
    ? (stats.late > 0 ? "atrasado" : stats.running > 0 ? "em_andamento" : "nao_iniciado")
    : project.status;
  const currentStatusClass = project.status === "verde"
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : project.status === "amarelo" || stats.late > 0
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : project.status === "vermelho"
        ? "border-rose-300 bg-rose-50 text-rose-800"
        : "border-blue-300 bg-blue-50 text-blue-800";

  const exportActivities = () => {
    const headers = ["PPSA", "Atividade", "Nível", "Gestão", "Módulo", "Responsável", "Data Início Prevista", "Data Término Prevista", "Data Início Realizada", "Data Final Realizada", "Semanas Programadas", "Término Realizado do Módulo", "Horas Planejadas", "Horas Realizadas", "Diferença (Plan. - Real.)", "Estouro de Horas", "Avanço (%)", "Status Fonte", "Status Consolidado"];
    const rows = filteredActivities.map((activity) => [
      activity.ppsaCode,
      activity.description,
      `Nível ${activity.level}`,
      activity.managementName || "Gestão Geral",
      activity.moduleName || "Módulo Geral",
      activity.resource || "Não informado",
      dateBR(activity.plannedStart),
      dateBR(activity.plannedEnd),
      dateBR(activity.actualStart),
      dateBR(activity.actualEnd),
      activity.plannedDays ? `${Math.max(1, Math.round(Number(activity.plannedDays) / 5))} sem` : "",
      dateBR(activity.moduleActualEndDate),
      `${numberBR(activity.plannedHours, 2)} h`,
      `${numberBR(activity.actualHours, 2)} h`,
      `${numberBR(Number(activity.plannedHours || 0) - Number(activity.actualHours || 0), 2)} h`,
      activity.hoursOverrunStatus || "Regular",
      activity.progressPct,
      activity.sourceStatus || "",
      statusLabel(activity.status),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `projeto-${project.code}-atividades.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportManagementSummaryPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const formatPdf = (value: number, decimals = 1) => value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const truncate = (value: unknown, maxLength: number) => {
      const text = String(value ?? "");
      return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    };
    let cursorY = 16;

    const ensureSpace = (height: number) => {
      if (cursorY + height > pageHeight - 12) {
        pdf.addPage();
        cursorY = 16;
      }
    };
    const sectionTitle = (title: string) => {
      ensureSpace(12);
      pdf.setFillColor(239, 246, 255);
      pdf.roundedRect(14, cursorY - 5, pageWidth - 28, 8, 1.5, 1.5, "F");
      pdf.setTextColor(30, 58, 138);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text(title, 17, cursorY);
      cursorY += 9;
    };
    const drawTable = (headers: string[], rows: string[][], widths: number[]) => {
      const rowHeight = 6;
      const drawRow = (values: string[], isHeader = false) => {
        ensureSpace(rowHeight + 2);
        let x = 14;
        const totalWidth = widths.reduce((sum, width) => sum + width, 0);
        pdf.setFillColor(isHeader ? 11 : 248, isHeader ? 56 : 251, isHeader ? 72 : 253);
        pdf.setDrawColor(226, 232, 240);
        pdf.rect(14, cursorY - 4.5, totalWidth, rowHeight, "FD");
        values.forEach((value, index) => {
          pdf.setTextColor(isHeader ? 255 : 30, isHeader ? 255 : 41, isHeader ? 255 : 59);
          pdf.setFont("helvetica", isHeader ? "bold" : "normal");
          pdf.setFontSize(isHeader ? 7 : 6.5);
          pdf.text(truncate(value, Math.max(8, Math.floor((widths[index] || 20) / 1.55))), x + 1.5, cursorY - 0.5);
          x += widths[index] || 20;
          if (index < values.length - 1) pdf.line(x, cursorY - 4.5, x, cursorY + 1.5);
        });
        cursorY += rowHeight;
      };
      drawRow(headers, true);
      rows.forEach((row) => drawRow(row));
      cursorY += 3;
    };

    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text(`Resumo Gerencial de Horas — Projeto #${project.code}`, 14, cursorY);
    cursorY += 7;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`${project.name} • Cliente: ${project.client} • Emitido em ${new Date().toLocaleDateString("pt-BR")}`, 14, cursorY);
    cursorY += 5;
    pdf.text(`Status atual: ${currentStatusLabel} • Fonte: ${usesLegacySql ? "SQL anterior — valores recebidos da API" : "valores recebidos da API"}`, 14, cursorY);
    cursorY += 10;

    const pdfHoursLabels = productivityIsOfficial
      ? ["Produtivas realizadas", "Improdutivas realizadas", "Desvio improdutividade"]
      : ["Realizadas no cronograma", "Fora do cronograma", "Composição por escopo"];
    const pdfHoursValues = productivityIsOfficial
      ? [
          `${formatPdf(scheduleScopeMetrics.productiveActual)} h`,
          `${formatPdf(scheduleScopeMetrics.unproductiveActual)} h`,
          `${formatPdf(productivityDeviation.unproductivePct)}%${productivityDeviation.exceedsThreshold ? " — acima de 30%" : " — dentro do limite"}`,
        ]
      : [
          `${formatPdf(scheduleScopeMetrics.productiveActual)} h`,
          `${formatPdf(scheduleScopeMetrics.unproductiveActual)} h`,
          "Produtividade não informada",
        ];
    sectionTitle(productivityIsOfficial ? "Indicadores oficiais gerenciais de horas" : "Indicadores de horas recebidos da API");
    drawTable(
      ["Total planejado", "No cronograma", "Fora do cronograma", ...pdfHoursLabels, "% realizado"],
      [[
        `${formatPdf(scheduleScopeMetrics.total.planned)} h`,
        `${formatPdf(scheduleScopeMetrics.inSchedule.planned)} h`,
        `${formatPdf(scheduleScopeMetrics.outsideSchedule.planned)} h`,
        ...pdfHoursValues,
        `${formatPdf(managementOverview.completionPct)}%`,
      ]],
      [32, 32, 36, 39, 39, 42, 28],
    );
    pdf.setTextColor(71, 85, 105);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(productivityIsOfficial
      ? "Regra: produtivas e improdutivas reproduzem os campos oficiais enviados pela API."
      : "Regra: o relatório reproduz os campos de horas enviados pela API; a separação por cronograma não é produtividade.", 14, cursorY);
    cursorY += 8;

    sectionTitle("Gestão / Módulo — Planejadas x Realizadas");
    drawTable(
      ["Gestão", "Módulo", "Nível", "PPSAs", "Planejadas", "Realizadas", "Saldo", "%", "Status"],
      managementModuleSummary.map((item) => [
        item.managementName,
        item.moduleName,
        `N${item.level}`,
        `${item.ppsaCount}`,
        `${formatPdf(item.plannedHours)} h`,
        `${formatPdf(item.actualHours)} h`,
        `${item.balanceHours >= 0 ? "+" : ""}${formatPdf(item.balanceHours)} h`,
        `${formatPdf(item.hoursProgressPct)}%`,
        statusLabel(item.status),
      ]),
      [30, 52, 16, 20, 30, 30, 28, 20, 30],
    );

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Fonte: Gestão 360° CS Compusoftware • Níveis PPSA separados sem soma hierárquica • Documento gerencial para acompanhamento PMBOK.", 14, pageHeight - 7);
    pdf.save(`projeto-${project.code}-resumo-gerencial-horas.pdf`);
  };

  return (
    <div className="space-y-5">
      <GlobalFilterBar showProjectSelector />

      <div className="flex items-center justify-between gap-3">
        <Link href="/"><Button variant="ghost" size="sm" className="h-8 text-xs"><ArrowLeft className="w-3.5 h-3.5 mr-1" />Portfólio</Button></Link>
        <div className="text-xs text-slate-500">Filtros aplicados globalmente nesta aba</div>
      </div>

      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-5">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <select
                  value={String(project.id)}
                  onChange={(event) => {
                    const id = event.target.value;
                    const selected = globallyFilteredProjects.find((item) => String(item.id) === id);
                    setProjectFilter(id);
                    if (selected?.startDate && selected.startDate !== "Sem data") setDateStart(selected.startDate);
                    setDateEnd(currentDateIso());
                    setLocation(`/projeto/${id}`);
                  }}
                  className="h-8 max-w-[360px] text-xs font-bold bg-blue-50 text-blue-900 border border-blue-200 px-2 rounded-md"
                >
                  {globallyFilteredProjects.length === 0 ? (
                    <option value="">Nenhum projeto atende aos filtros aplicados</option>
                  ) : globallyFilteredProjects.map((item) => <option key={item.id} value={String(item.id)}>#{item.code} - {item.name} ({item.client})</option>)}
                </select>
                <Badge className={statusClass(currentStatusCode)}><span className={`h-2 w-2 rounded-full ${statusDotClass(currentStatusCode)}`} />{currentStatusLabel}</Badge>
              </div>
              <h1 className="text-xl font-bold text-slate-900 truncate">{project.name}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
                <span><strong>Cliente:</strong> {project.client}</span>
                <span><strong>Gestor:</strong> {project.sponsor || (project.managerCode ? `Gestor #${project.managerCode}` : "Não informado")}</span>
                <span><strong>Responsável:</strong> {project.managerName || "Não informado"}</span>
                <span><strong>Tipo:</strong> {project.projectTypeDescription || project.projectType || "Não informado"}</span>
                <span><strong>Data final prevista:</strong> {plannedProjectEnd}</span>
                <span><strong>Finalização:</strong> {finalDate}</span>
                {project.scopeDate && <span><strong>Data de escopo:</strong> {dateBR(project.scopeDate)}</span>}
                {project.sourcePhaseCode && <span><strong>Fase:</strong> {project.sourcePhaseCode}</span>}
                {project.segmentId && <span><strong>Segmento:</strong> #{project.segmentId}</span>}
                <span className="inline-flex items-center gap-1 font-semibold">
                  <strong>Situação:</strong>
                  <span className={project.isActive ? "text-emerald-700" : "text-slate-500"}>
                    {project.isActive ? "Ativo" : "Encerrado"}
                  </span>
                </span>
              </div>
              <div className="text-[11px] text-blue-800 mt-2 flex items-center gap-1"><FileText className="w-3 h-3" />{sourceLabel}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={exportManagementSummaryPdf} className="h-8 text-xs border-blue-200 text-blue-900 hover:bg-blue-50"><FileText className="w-3.5 h-3.5 mr-1" />Resumo gerencial PDF</Button>
              <Link href={`/apontamento-semanal?project=${project!.id}`}><Button size="sm" className="h-8 text-xs bg-[#CF142B] hover:bg-[#A40F21] text-white font-semibold"><PlusCircle className="w-3.5 h-3.5 mr-1" />Check-in semanal</Button></Link>
              <Link href={`/riscos-problemas?project=${project!.id}`}><Button size="sm" variant="outline" className="h-8 text-xs"><ShieldAlert className="w-3.5 h-3.5 mr-1" />Registrar risco</Button></Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-[#0B3848]/25 shadow-sm">
        <CardHeader className="border-b border-[#0B3848]/15 bg-gradient-to-r from-[#072530] via-[#0B3848] to-[#16566D] p-4 text-white">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-white"><Target className="h-4 w-4 text-cyan-200" />Resumo gerencial do projeto</CardTitle>
              <CardDescription className="mt-1 text-xs text-slate-200">Visão PMBOK do que precisa ser acompanhado agora, reproduzindo os valores de horas recebidos da API.</CardDescription>
            </div>
            <Badge variant="outline" className={`w-fit text-xs font-bold ${currentStatusClass}`}><span className={`mr-1.5 h-2 w-2 rounded-full ${statusDotClass(currentStatusCode)}`} />Status atual: {currentStatusLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Pendências Nível 1</div><div className="mt-1 text-2xl font-bold text-slate-900">{numberBR(managementOverview.pendingActivities)}</div><div className="text-[10px] text-slate-500">PPSAs não concluídos</div></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Gestões</div><div className="mt-1 text-2xl font-bold text-blue-950">{numberBR(managementOverview.managementCount)}</div><div className="text-[10px] text-blue-700">Com PPSA Nível 1</div></div>
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-violet-700">Módulos</div><div className="mt-1 text-2xl font-bold text-violet-950">{numberBR(managementOverview.moduleCount)}</div><div className="text-[10px] text-violet-700">Gestão / Módulo consolidado</div></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Atrasadas</div><div className="mt-1 text-2xl font-bold text-amber-900">{numberBR(stats.late)}</div><div className="text-[10px] text-amber-700">Atividades fora do prazo</div></div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Avanço por horas</div><div className="mt-1 text-2xl font-bold text-emerald-900">{numberBR(managementOverview.completionPct, 1)}%</div><div className="text-[10px] text-emerald-700">Realizadas ÷ planejadas</div></div>
          </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total Horas Planejadas</div>
              <div className="mt-1 text-xl font-bold text-slate-900">{numberBR(scheduleScopeMetrics.total.planned, 1)} h</div>
              <div className="text-[10px] text-slate-500">
                {numberBR(scheduleScopeMetrics.inSchedule.planned, 1)} h no cronograma + {numberBR(scheduleScopeMetrics.outsideSchedule.planned, 1)} h fora do cronograma
              </div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700">{productivityIsOfficial ? "Total Horas Produtivas Realizadas" : "Total Horas Realizadas — API"}</div>
              <div className="mt-1 text-xl font-bold text-blue-950">{numberBR(scheduleScopeMetrics.total.actual, 1)} h</div>
              <div className="text-[10px] text-blue-700">
                {productivityIsOfficial ? "Produtivas oficiais recebidas da API" : "HORAS_TOTAL recebidas da API"} ({numberBR(managementOverview.completionPct, 1)}% do planejado)
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800">{productivityIsOfficial ? "Total Horas Improdutivas Realizadas" : "Realizado por escopo da API"}</div>
              {productivityIsOfficial ? (
                <>
                  <div className="mt-1 text-xl font-bold text-amber-950">{numberBR(scheduleScopeMetrics.unproductiveActual, 1)} h</div>
                  <div className="text-[10px] text-amber-800">Improdutivas oficiais recebidas da API</div>
                </>
              ) : (
                <div className="mt-2 space-y-1 text-[11px] font-semibold text-amber-950">
                  <div>No cronograma: {numberBR(scheduleScopeMetrics.productiveActual, 1)} h</div>
                  <div>Fora do cronograma: {numberBR(scheduleScopeMetrics.unproductiveActual, 1)} h</div>
                </div>
              )}
            </div>
            <div className={`rounded-lg border p-3 ${!productivityIsOfficial ? "border-slate-300 bg-slate-50" : productivityDeviation.exceedsThreshold ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50"}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wide ${!productivityIsOfficial ? "text-slate-700" : productivityDeviation.exceedsThreshold ? "text-rose-800" : "text-emerald-800"}`}>{productivityIsOfficial ? "Desvio de produtividade" : "Produtividade separada"}</div>
              <div className={`mt-1 text-xl font-bold ${!productivityIsOfficial ? "text-slate-800" : productivityDeviation.exceedsThreshold ? "text-rose-950" : "text-emerald-950"}`}>{productivityIsOfficial ? `${numberBR(productivityDeviation.unproductivePct, 1)}%` : "Não informado"}</div>
              <div className={`text-[10px] ${!productivityIsOfficial ? "text-slate-600" : productivityDeviation.exceedsThreshold ? "text-rose-800" : "text-emerald-800"}`}>{productivityIsOfficial ? "Improdutivas sobre o total realizado" : "A API não enviou produtivas/improdutivas"}</div>
              <UiTooltip>
                <UiTooltipTrigger asChild>
                  <span className="mt-2 inline-flex cursor-help items-center gap-1">
                    <Badge variant="outline" className={`text-[10px] ${!productivityIsOfficial ? "border-slate-400 bg-white text-slate-700" : productivityDeviation.exceedsThreshold ? "border-rose-400 bg-rose-100 text-rose-800" : "border-emerald-400 bg-emerald-100 text-emerald-800"}`}>
                      {productivityIsOfficial ? (productivityDeviation.exceedsThreshold ? "Acima do limite de 30%" : "Dentro do limite de 30%") : "Não informado pela API"}
                    </Badge>
                    <Info className="h-3 w-3 text-slate-400" />
                  </span>
                </UiTooltipTrigger>
                <UiTooltipContent className="max-w-xs text-[11px] leading-4">
                  {productivityIsOfficial
                    ? "O indicador mostra horas improdutivas ÷ (horas produtivas + horas improdutivas). Acima de 30% fica vermelho para sinalizar desvio de produtividade e necessidade de ação gerencial."
                    : "A API não enviou campos separados de horas produtivas e improdutivas. O sistema mantém o realizado e o escopo do cronograma, sem estimar produtividade."}
                </UiTooltipContent>
              </UiTooltip>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-600"><span><strong>Início do projeto:</strong> {dateBR(project.startDate)}</span><span><strong>Final previsto:</strong> {plannedProjectEnd}</span><span><strong>Janela de análise:</strong> {dateBR(dateStart || project.startDate)} até {dateBR(dateEnd || new Date().toISOString().slice(0, 10))}</span></div>
          <div className="rounded-md border border-blue-200 bg-blue-50/80 px-3 py-2 text-[10px] leading-4 text-blue-950">
            <strong>{productivityIsOfficial ? "Contrato oficial SQL Rev03" : productivityIsManaged ? "Produtividade informada pela API" : "Composição por escopo da API"}:</strong> Total planejado ({numberBR(scheduleScopeMetrics.total.planned, 1)} h) dividido em <strong>{numberBR(scheduleScopeMetrics.inSchedule.planned, 1)} h no cronograma</strong> e <strong>{numberBR(scheduleScopeMetrics.outsideSchedule.planned, 1)} h fora do cronograma</strong>; horas realizadas separadas por vínculo em <strong>{numberBR(scheduleScopeMetrics.productiveActual, 1)} h {productivityIsOfficial || productivityIsManaged ? "produtivas" : "no cronograma"}</strong> e <strong>{numberBR(scheduleScopeMetrics.unproductiveActual, 1)} h {productivityIsOfficial || productivityIsManaged ? "improdutivas" : "fora do cronograma"}</strong> ({numberBR(managementOverview.completionPct, 1)}% realizado x planejado).
            {!productivityIsOfficial && !productivityIsManaged && ` ${usesRev06View ? "A View REV06 não classifica produtividade oficialmente; a separação acima é somente por vínculo do apontamento ao cronograma." : "A SQL anterior não classifica produtividade oficialmente; a separação acima é feita pelo vínculo do apontamento ao cronograma."}`}
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-200/80 bg-white shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-blue-100 bg-blue-50/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-blue-950 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0B3848]" />
                Estrutura Gerencial por Gestão / Módulo — Horas Planejadas x Realizadas
              </CardTitle>
              <CardDescription className="text-xs text-slate-600">
                Agregação por Gestão, Módulo e Nível PPSA. Níveis 1, 2, 3 e 4 ficam separados; os totalizadores gerenciais usam somente o primeiro nível disponível para não duplicar a hierarquia.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-semibold border-blue-300 bg-blue-100 text-blue-950 self-start sm:self-auto">
              {managementModuleSummary.length} módulos oficiais • Total oficial da API: {numberBR(compositionTotals.planned, 1)} h plan. • {numberBR(compositionTotals.actual, 1)} h real.
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-72">
            <table className="w-full min-w-[1240px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Gestão</th>
                  <th className="px-3 py-2 text-left">Módulo</th>
                  <th className="px-3 py-2 text-center">Camada</th>
                  <th className="px-3 py-2 text-center">PPSAs vinculados</th>
                  <th className="px-3 py-2 text-center">Data Inicial Prevista</th>
                  <th className="px-3 py-2 text-center">Data Final Prevista</th>
                  <th className="px-3 py-2 text-center">Semanas Programadas</th>
                  <th className="px-3 py-2 text-center">Horas Planejadas</th>
                  <th className="px-3 py-2 text-center">Data Inicial Realizada</th>
                  <th className="px-3 py-2 text-center">Data Final Realizada</th>
                  <th className="px-3 py-2 text-center">Horas Realizadas</th>
                  <th className="px-3 py-2 text-center">Saldo de Horas</th>
                  <th className="px-3 py-2 text-center">% Realizada (horas)</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {managementModuleSummary.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-6 text-center text-xs text-slate-400">
                      Nenhuma atividade compõe este indicador no momento.
                    </td>
                  </tr>
                ) : (
                  managementModuleSummary.map((item) => {
                    const groupKey = `${item.managementKey}|${item.moduleKey}|N${item.level}`;
                    const isExpanded = expandedManagementModules.has(groupKey);
                    const ppsaList = activities.filter((a) => a.level === item.level && item.ppsaCodes.includes(a.ppsaCode));
                    return (
                      <tr key={groupKey} className="hover:bg-blue-50/40 transition-colors">
                        <td className="px-3 py-2 align-middle">
                          <div className="font-bold text-slate-900">{item.managementName}</div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="text-slate-800 font-semibold">{item.moduleName}</div>
                        </td>
                        <td className="px-3 py-2 text-center align-middle whitespace-nowrap">
                          <Badge variant="outline" className={`text-[10px] ${item.level === 1 ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-slate-50 text-slate-700"}`}>N{item.level}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center align-middle whitespace-nowrap">
                          {item.ppsaCount > 1 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedManagementModules((curr) => {
                                  const next = new Set(curr);
                                  if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded border border-blue-200"
                              title={`Clique para detalhar os PPSAs do Nível ${item.level}`}
                            >
                              {item.ppsaCount} PPSAs N{item.level}
                              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                              {item.ppsaCodes[0] || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600 align-middle">{dateBR(item.plannedStart)}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-700 font-medium align-middle">{dateBR(item.plannedEnd)}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-medium text-slate-700 align-middle">{item.plannedWeeks != null ? `${numberBR(item.plannedWeeks, 1)} sem` : <span className="text-slate-400 text-[10px]">Não informado</span>}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-semibold text-slate-900 align-middle">{numberBR(item.plannedHours, 1)} h</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600 align-middle">{item.actualStart ? dateBR(item.actualStart) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600 align-middle">{item.actualEnd ? dateBR(item.actualEnd) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-bold text-blue-900 align-middle">{numberBR(item.actualHours, 1)} h</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-semibold align-middle">
                          <span className={item.balanceHours >= 0 ? "text-emerald-700" : "text-rose-700 font-bold"}>
                            {item.balanceHours >= 0 ? "+" : ""}{numberBR(item.balanceHours, 1)} h
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-semibold text-slate-800 align-middle">{numberBR(item.hoursProgressPct, 1)}%</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap align-middle">
                          <Badge variant="outline" className={`text-[10px] gap-1 ${statusClass(item.status)}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(item.status)}`} />
                            {statusLabel(item.status)}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="border-t-2 border-blue-200 bg-blue-50/70">
                <tr className="text-xs font-bold text-blue-950">
                  <td colSpan={6} className="px-3 py-3 text-right">Total consolidado oficial da API — Gestão / Módulo</td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">{compositionTotals.plannedWeeks != null ? `${numberBR(compositionTotals.plannedWeeks, 1)} sem` : <span className="text-slate-400 text-[10px]">Não informado</span>}</td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">{numberBR(compositionTotals.planned, 1)} h</td>
                  <td colSpan={2} className="px-3 py-3" />
                  <td className="px-3 py-3 text-center whitespace-nowrap text-blue-900">{numberBR(compositionTotals.actual, 1)} h</td>
                  <td className="px-3 py-3 text-center whitespace-nowrap text-emerald-800">
                    {compositionTotals.balance >= 0 ? "+" : ""}{numberBR(compositionTotals.balance, 1)} h
                  </td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">{numberBR(compositionTotals.completionPct, 1)}%</td>
                  <td className="px-3 py-3 text-center whitespace-nowrap">Consolidado</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>


      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">Avanço Físico — por atividade</div>
      <div className="grid grid-cols-2 lg:grid-cols-8 gap-3">
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Atividades</div><div className="text-2xl font-bold text-slate-900 mt-1">{numberBR(stats.total)}</div><div className="text-[10px] text-slate-400">Total do projeto</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Concluídas</div><div className="text-2xl font-bold text-emerald-700 mt-1">{numberBR(stats.done)}</div><div className="text-[10px] text-emerald-600">{numberBR(stats.total ? stats.done / stats.total * 100 : 0)}%</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Em andamento</div><div className="text-2xl font-bold text-blue-700 mt-1">{numberBR(stats.running)}</div><div className="text-[10px] text-blue-600">{numberBR(stats.total ? stats.running / stats.total * 100 : 0)}%</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Atrasadas</div><div className="text-2xl font-bold text-orange-600 mt-1">{numberBR(stats.late)}</div><div className="text-[10px] text-orange-600">Atenção</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Não iniciadas</div><div className="text-2xl font-bold text-slate-600 mt-1">{numberBR(stats.notStarted)}</div><div className="text-[10px] text-slate-400">Aguardando</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[11px] text-slate-500">Avanço geral</div><div className="text-2xl font-bold text-emerald-700 mt-1">{numberBR(stats.progress, 0)}%</div><Progress value={stats.progress} className="h-1.5 mt-2" /></CardContent></Card>
        <Card className="border-slate-200 bg-slate-50/60"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Horas planejadas — API</div><div className="text-2xl font-bold text-slate-900 mt-1">{numberBR(physicalMetrics.plannedHours, 1)} h</div><div className="text-[10px] text-slate-500 mt-1">Valor recebido da fonte</div><div className="text-[10px] text-slate-400 mt-1">Até o período: {numberBR(physicalMetrics.plannedHoursToDate, 1)} h</div><Badge variant="outline" className={`mt-2 text-[10px] ${periodHoursBalance >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo do período: {periodHoursBalance >= 0 ? "+" : "−"}{numberBR(Math.abs(periodHoursBalance), 1)} h</Badge></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/30"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Horas realizadas — PPSA Nível 1</div><div className="text-2xl font-bold text-blue-900 mt-1">{numberBR(physicalMetrics.actualHours, 1)} h</div><div className="text-[10px] text-slate-500 mt-1">Apontamentos consolidados</div><div className="text-[10px] text-blue-700 mt-1">Até o período: {numberBR(physicalMetrics.actualHoursToDate, 1)} h</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-blue-200 bg-blue-50/35 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">No Cronograma</div>
                <div className="mt-1 text-2xl font-bold text-blue-950">{numberBR(scheduleScopeMetrics.inSchedule.planned, 1)} h</div>
                <div className="mt-1 text-xs text-slate-600">Planejadas • {numberBR(scheduleScopeMetrics.inSchedule.actual, 1)} h realizadas</div>
                <div className="mt-1 text-[10px] text-slate-500">{numberBR(scheduleScopeMetrics.inSchedule.count)} PPSA Nível 1 com ID de cronograma</div>
                <Badge variant="outline" className={`mt-2 text-[10px] ${scheduleScopeMetrics.inSchedule.balance >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo: {scheduleScopeMetrics.inSchedule.balance >= 0 ? "+" : "−"}{numberBR(Math.abs(scheduleScopeMetrics.inSchedule.balance), 1)} h</Badge>
              </div>
              <CalendarClock className="mt-1 h-5 w-5 text-blue-700" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/45 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Fora do Cronograma / Apontamentos Avulsos</div>
                <div className="mt-1 text-2xl font-bold text-amber-950">{numberBR(scheduleScopeMetrics.outsideSchedule.planned, 1)} h</div>
                <div className="mt-1 text-xs text-slate-600">Planejadas • {numberBR(scheduleScopeMetrics.outsideSchedule.actual, 1)} h realizadas</div>
                <div className="mt-1 text-[10px] text-slate-600">{numberBR(scheduleScopeMetrics.outsideSchedule.count)} PPSA Nível 1 sem ID de cronograma</div>
                <Badge variant="outline" className={`mt-2 text-[10px] ${scheduleScopeMetrics.outsideSchedule.balance >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo: {scheduleScopeMetrics.outsideSchedule.balance >= 0 ? "+" : "−"}{numberBR(Math.abs(scheduleScopeMetrics.outsideSchedule.balance), 1)} h</Badge>
              </div>
              <CircleDot className="mt-1 h-5 w-5 text-amber-700" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className={physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 ? "border-rose-400 bg-rose-50 ring-2 ring-rose-200" : "border-blue-200 bg-blue-50/40"}><CardContent className="p-4"><div className={`text-[11px] font-semibold ${physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 ? "text-rose-800" : "text-blue-800"}`}>Avanço físico calculado {physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 ? "• Abaixo do programado" : ""}</div><div className={`mt-1 text-2xl font-bold ${physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 ? "text-rose-900" : "text-blue-950"}`}>{numberBR(physicalMetrics.hoursProgress, 1)}%</div><div className="mt-1 text-[10px] text-slate-600">Horas realizadas ÷ horas planejadas</div><Progress value={physicalMetrics.hoursProgress} className={`mt-2 h-1.5 ${physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 ? "bg-rose-100" : ""}`} /><div className="mt-1 text-[10px] text-slate-500">{numberBR(physicalMetrics.actualHours, 1)} h realizadas de {numberBR(physicalMetrics.plannedHours, 1)} h</div>{physicalMetrics.programmedProgress - physicalMetrics.hoursProgress >= 10 && <div className="mt-2 text-[10px] font-semibold text-rose-700">Alerta: {numberBR(physicalMetrics.programmedProgress - physicalMetrics.hoursProgress, 1)} p.p. abaixo do programado</div>}</CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="p-4"><div className="text-[11px] font-semibold text-emerald-800">Avanço físico informado</div><div className="mt-1 text-2xl font-bold text-emerald-900">{numberBR(physicalMetrics.informedProgress, 1)}%</div><div className="mt-1 text-[10px] text-slate-600">{physicalMetrics.informedProgress > 0 ? "Último avanço registrado no Check-in Semanal" : "Sem Check-in Semanal registrado — valor 0,0%"}</div><Progress value={physicalMetrics.informedProgress} className="mt-2 h-1.5" /></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/50"><CardContent className="p-4"><div className="text-[11px] font-semibold text-amber-800">Avanço físico programado (cronograma)</div><div className="mt-1 text-2xl font-bold text-amber-900">{numberBR(physicalMetrics.programmedProgress, 1)}%</div><div className="mt-1 text-[10px] text-slate-600">Quanto deveria estar concluído até hoje</div><div className="mt-1 text-[10px] text-amber-900 font-medium">Avanço físico concluído por atividades: {numberBR(physicalMetrics.physicalActivitiesProgress, 1)}% ({numberBR(physicalMetrics.completedActivities)} concluídas)</div><Progress value={physicalMetrics.programmedProgress} className="mt-2 h-1.5" /></CardContent></Card>
      </div>

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900">Avanço físico: calculado x informado x programado</CardTitle>
              <CardDescription className="text-xs">Gráfico de linhas comparativo. Clique nos botões ou marcadores para ver as atividades que compõem o indicador selecionado.</CardDescription>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[11px] text-slate-500 font-medium mr-1">Composição ativa:</span>
              <Button size="sm" variant={selectedPhysicalMetric === "programado" ? "default" : "outline"} onClick={() => setSelectedPhysicalMetric("programado")} className={`h-7 px-2.5 text-[11px] ${selectedPhysicalMetric === "programado" ? "bg-amber-600 hover:bg-amber-700 text-white" : "text-amber-800"}`}>Programado</Button>
              <Button size="sm" variant={selectedPhysicalMetric === "calculado" ? "default" : "outline"} onClick={() => setSelectedPhysicalMetric("calculado")} className={`h-7 px-2.5 text-[11px] ${selectedPhysicalMetric === "calculado" ? "bg-blue-900 hover:bg-blue-800 text-white" : "text-blue-950"}`}>Calculado</Button>
              <Button size="sm" variant={selectedPhysicalMetric === "informado" ? "default" : "outline"} onClick={() => setSelectedPhysicalMetric("informado")} className={`h-7 px-2.5 text-[11px] ${selectedPhysicalMetric === "informado" ? "bg-emerald-700 hover:bg-emerald-800 text-white" : "text-emerald-900"}`}>Informado</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-64 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={physicalMetrics.chart} margin={{ top: 12, right: 24, left: -14, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#475569" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} />
              <Tooltip formatter={(value, name) => [`${numberBR(value, 1)}%`, name === "calculado" ? "Calculado por horas" : name === "informado" ? "Informado no check-in" : "Programado"]} />
              <Legend formatter={(value) => value === "calculado" ? "Calculado por horas" : value === "informado" ? "Informado no check-in" : "Programado"} />
              <Line type="monotone" dataKey="programado" name="programado" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, cursor: "pointer", onClick: () => setSelectedPhysicalMetric("programado") }}>
                <LabelList dataKey="programado" position="top" formatter={(val: any) => `${numberBR(val, 1)}%`} style={{ fontSize: 9, fontWeight: 700, fill: "#b45309" }} />
              </Line>
              <Line type="monotone" dataKey="calculado" name="calculado" stroke="#2563eb" strokeWidth={3} dot={{ r: 5, cursor: "pointer", onClick: () => setSelectedPhysicalMetric("calculado") }}>
                <LabelList dataKey="calculado" position="top" formatter={(val: any) => `${numberBR(val, 1)}%`} style={{ fontSize: 9, fontWeight: 700, fill: "#1d4ed8" }} />
              </Line>
              <Line type="monotone" dataKey="informado" name="informado" stroke="#16a34a" strokeWidth={3} dot={{ r: 5, cursor: "pointer", onClick: () => setSelectedPhysicalMetric("informado") }}>
                <LabelList dataKey="informado" position="bottom" formatter={(val: any) => `${numberBR(val, 1)}%`} style={{ fontSize: 9, fontWeight: 700, fill: "#15803d" }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <SCurveSection projectId={effectiveProjectId ?? 0} projectName={project.name} />

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-slate-100">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex flex-wrap items-center gap-2"><ListTree className="w-4 h-4 text-blue-900" />Estrutura Analítica do Cronograma (PPSA)<Badge variant="outline" className="border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800"><Flag className="mr-1 h-3.5 w-3.5" />{numberBR(milestoneCount)} marco(s) concluído(s)</Badge></CardTitle>
              <CardDescription className="text-xs">Acompanhe as atividades por nível, gestão, módulo e responsável. Horas planejadas vêm da coluna operacional da planilha; os totalizadores gerenciais somam somente o Nível 1.</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Exibir até o nível:</span>
              {levelOptions.map((level) => <Button key={level} size="sm" variant={visibleLevel === level ? "default" : "outline"} onClick={() => { setVisibleLevel(level); setAllCollapsed(false); }} className={`h-7 w-8 p-0 text-xs ${visibleLevel === level ? "bg-blue-900 hover:bg-blue-800" : ""}`}>{level}</Button>)}
              <Button size="sm" variant="outline" onClick={() => { setCollapsed(new Set()); setAllCollapsed(false); }} className="h-7 text-xs ml-1"><FolderOpen className="w-3.5 h-3.5 mr-1" />Expandir tudo</Button>
              <Button size="sm" variant="outline" onClick={() => { setCollapsed(new Set(allExpandableKeys)); setAllCollapsed(true); }} className="h-7 text-xs"><Folder className="w-3.5 h-3.5 mr-1" />Recolher tudo</Button>
            </div>
          </div>
          <div className="flex flex-col md:flex-row gap-2 mt-3">
            <div className="relative flex-1"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar atividade, código ou descrição..." className="h-8 pl-8 text-xs" /></div>
            <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="h-8 px-2 text-xs border rounded-md bg-white md:w-48"><option value="todos">Todas as áreas</option>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 px-2 text-xs border rounded-md bg-white md:w-40"><option value="todos">Todos os status</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
            <select value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value as "todos" | "cronograma" | "avulsos")} className={`h-8 px-2 text-xs border rounded-md md:w-52 ${scheduleFilter === "cronograma" ? "border-blue-400 bg-blue-50 text-blue-900" : scheduleFilter === "avulsos" ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-white"}`} title="Separar os registros pela presença de ID de cronograma">
              <option value="todos">Todos os registros</option>
              <option value="cronograma">Apenas com Cronograma</option>
              <option value="avulsos">Apontamentos Avulsos</option>
            </select>
            <Button size="sm" variant={onlyOverrun ? "default" : "outline"} onClick={() => setOnlyOverrun((current) => !current)} className={`h-8 text-xs whitespace-nowrap ${onlyOverrun ? "bg-rose-700 hover:bg-rose-800" : ""}`} title="Mostrar somente atividades em que as horas realizadas ultrapassaram as planejadas"><AlertTriangle className="w-3.5 h-3.5 mr-1" />{onlyOverrun ? "Estouro ativo" : "Estouro de horas"}</Button>
            <Button size="sm" variant={sortMode === "endAsc" ? "default" : "outline"} onClick={() => setSortMode((current) => current === "endAsc" ? "ppsa" : "endAsc")} className={`h-8 text-xs whitespace-nowrap ${sortMode === "endAsc" ? "bg-blue-900 hover:bg-blue-800" : ""}`} title="Ordenar pela data de término mais próxima"><CalendarClock className="w-3.5 h-3.5 mr-1" />{sortMode === "endAsc" ? "Término: próximos" : "Ordenar por término"}</Button>
            <Button size="sm" variant="outline" onClick={exportActivities} className="h-8 text-xs"><Download className="w-3.5 h-3.5 mr-1" />Exportar</Button>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            {scheduleFilter === "cronograma" ? "Exibindo somente registros com ID de cronograma." : scheduleFilter === "avulsos" ? "Exibindo somente registros sem ID de cronograma." : "A separação usa o ID de cronograma enviado pela API e preserva os valores de horas recebidos."}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-[10px] text-slate-500">
            <span className="font-semibold text-slate-600">Leitura por nível:</span>
            <span className="rounded border-l-4 border-blue-700 border-y border-r border-blue-300 bg-sky-100 px-2 py-1 text-blue-950 font-semibold">Nível 1 — Macroestrutura</span>
            <span className="rounded border-l-4 border-violet-600 border-y border-r border-violet-300 bg-violet-100 px-2 py-1 text-violet-950 font-semibold">Nível 2 — Processo</span>
            <span className="rounded border-l-4 border-emerald-500 border-y border-r border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-950 font-semibold">Nível 3 — Atividade</span>
            <span className="rounded border-l-4 border-amber-500 border-y border-r border-amber-300 bg-amber-100 px-2 py-1 text-amber-950 font-semibold">Nível 3 — Atenção</span>
            <span className="inline-flex items-center gap-1 rounded border-l-4 border-fuchsia-700 border-y border-r border-fuchsia-300 bg-fuchsia-100 px-2 py-1 text-fuchsia-950 font-semibold"><Flag className="h-3 w-3" />Marco concluído — Nível 1</span>
            <span className="ml-1 border-l border-slate-200 pl-2 font-semibold text-slate-600">Status:</span>
            <button type="button" onClick={() => setStatusFilter("todos")} className={`rounded border px-2 py-1 font-semibold transition-colors ${statusFilter === "todos" ? "border-blue-500 bg-blue-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"}`}>Todos</button>
            {statusLegend.map((status) => <button key={status} type="button" onClick={() => setStatusFilter(statusFilter === status ? "todos" : status)} className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-semibold transition-colors ${statusFilter === status ? `${statusClass(status)} ring-2 ring-blue-300` : `${statusClass(status)} opacity-80 hover:opacity-100`}`}><span className={`h-2 w-2 rounded-full ${statusDotClass(status)}`} />{statusLabel(status)}</button>)}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {activities.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">Este projeto está no cadastro mestre e ainda não possui atividades operacionais.</div>
          ) : (
            <div className="overflow-x-auto max-h-[660px]">
              <table className="w-full min-w-[1480px] text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[11px] text-slate-600">
                    <th className="px-3 py-2.5 w-[270px]">Estrutura / Atividade</th>
                    <th className="px-3 py-2.5 w-20">Nível</th>
                    <th className="px-3 py-2.5 w-[190px]">Gestão e Módulo</th>
                    <th className="px-3 py-2.5 w-[150px]">Responsável</th>
                    <th className="px-3 py-2.5 text-center">Planejado</th>
                    <th className="px-3 py-2.5 text-center">Realizado</th>
                    <th className="px-3 py-2.5 text-center">Data Início da Atividade</th>
                    <th className="px-3 py-2.5 text-center">Data Término da Atividade</th>
                    <th className="px-3 py-2.5 text-center">Data Início Realizada</th>
                    <th className="px-3 py-2.5 text-center">Data Final Realizada</th>
                    <th className="px-3 py-2.5 text-center">Semanas Programadas</th>
                    <th className="px-3 py-2.5 text-center">Horas Planejadas</th>
                    <th className="px-3 py-2.5 text-center">Horas Realizadas</th>
                    <th className="px-3 py-2.5 text-center">Dif. Plan. x Real.</th>
                    <th className="px-3 py-2.5 text-center">Estouro de Horas</th>
                    <th className="px-3 py-2.5 text-center">Avanço</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleActivities.map((activity) => {
                    const hasChildren = childrenByParent.has(activity.ppsaCode);
                    const isCollapsed = collapsed.has(activity.ppsaCode);
                    const indent = Math.max(0, (activity.level - 1) * 20);
                    const isDone = isCompletedActivity(activity);
                    const isMilestone = isCompletedLevel1Milestone(activity);
                    const deadline = remainingDays(activity.plannedEnd, isDone);
                    const plannedWeeks = activity.plannedDays
                      ? Math.max(1, Math.round(Number(activity.plannedDays) / 5))
                      : activity.plannedStart && activity.plannedEnd && activity.plannedStart !== "Sem data" && activity.plannedEnd !== "Sem data"
                      ? Math.max(1, Math.round(Math.abs(new Date(`${activity.plannedEnd}T00:00:00`).getTime() - new Date(`${activity.plannedStart}T00:00:00`).getTime()) / (7 * 86400000)))
                      : null;
                    return (
                      <tr key={activity.id} className={`border-b transition-colors ${ppsaRowClass(activity.level, activity.status, isMilestone)}`}>
                        <td className="px-3 py-2" style={{ paddingLeft: `${12 + indent}px` }}>
                          <div className="flex items-start gap-1.5">
                            <button type="button" onClick={() => { if (!hasChildren) return; setAllCollapsed(false); toggleNode(activity.ppsaCode); }} className={`mt-0.5 w-4 h-4 flex items-center justify-center ${hasChildren ? "text-slate-500 hover:text-blue-900" : "text-transparent"}`} aria-label={isCollapsed ? "Expandir" : "Recolher"}>
                              {hasChildren ? (isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : <CircleDot className="w-2 h-2" />}
                            </button>
                            {hasChildren ? (isCollapsed ? <Folder className={`w-4 h-4 shrink-0 ${activity.level === 1 ? "text-blue-800" : activity.level === 2 ? "text-violet-700" : "text-emerald-700"}`} /> : <FolderOpen className={`w-4 h-4 shrink-0 ${activity.level === 1 ? "text-blue-800" : activity.level === 2 ? "text-violet-700" : "text-emerald-700"}`} />) : <MinusCircle className="w-3.5 h-3.5 text-emerald-700 mt-0.5 shrink-0" />}
                            <div className="min-w-0"><div className={`font-mono text-[10px] font-bold ${activity.level === 1 ? "text-blue-950" : activity.level === 2 ? "text-violet-950" : "text-emerald-950"}`}>{activity.ppsaCode}</div><div className={`flex flex-wrap items-center gap-1.5 font-semibold leading-tight ${activity.level === 1 ? "text-blue-950" : activity.level === 2 ? "text-violet-950" : "text-emerald-950"}`}>{activity.description}{isMilestone && <Badge variant="outline" className="inline-flex gap-1 border-fuchsia-400 bg-white/80 px-1.5 py-0 text-[9px] font-bold text-fuchsia-800"><Flag className="h-3 w-3" />Marco concluído</Badge>}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-2"><Badge variant="outline" className={ppsaLevelBadgeClass(activity.level)}>Nível {activity.level}</Badge></td>
                        <td className="px-3 py-2"><div className={`font-semibold ${activity.level === 1 ? "text-blue-950" : activity.level === 2 ? "text-violet-950" : "text-emerald-950"}`}>{activity.managementName || "Gestão Geral"}</div><div className={`text-[10px] mt-0.5 font-medium ${activity.level === 1 ? "text-blue-800" : activity.level === 2 ? "text-violet-800" : "text-emerald-800"}`}>{activity.moduleName || "Módulo Geral"}</div></td>
                        <td className="px-3 py-2 text-slate-600">{activity.resource || "Não informado"}</td>
                        <td className="px-3 py-2 text-center text-slate-700">100%</td>
                        <td className="px-3 py-2 text-center text-slate-700">{numberBR(activity.progressPct, 0)}%</td>
                        <td className="px-3 py-2 text-center text-slate-600 whitespace-nowrap">{dateBR(activity.plannedStart)}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <div className="text-slate-700">{dateBR(activity.plannedEnd)}</div>
                          {deadline.label && <div className={`text-[10px] mt-0.5 ${deadline.className}`}>{deadline.label}</div>}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600">
                          {activity.actualStart && activity.actualStart !== "Sem data" ? dateBR(activity.actualStart) : <span className="text-slate-400 text-[10px]">Não iniciado</span>}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600">
                          <div>{activity.actualEnd && activity.actualEnd !== "Sem data" ? dateBR(activity.actualEnd) : <span className="text-slate-400 text-[10px]">Em aberto</span>}</div>
                          {activity.moduleActualEndDate && <div className="text-[9px] mt-0.5 font-semibold text-[#0B3848]">Módulo: {dateBR(activity.moduleActualEndDate)}</div>}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap font-medium text-slate-700">
                          {plannedWeeks ? `${plannedWeeks} sem` : <span className="text-slate-400 text-[10px]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-800 whitespace-nowrap">{numberBR(activity.plannedHours, 2)} h</td>
                        <td className="px-3 py-2 text-center font-semibold text-blue-800 whitespace-nowrap">
                          <div>{numberBR(activity.actualHours, 2)} h</div>
                          {activity.actualAtomicHours != null && Number(activity.actualAtomicHours) > 0 && activity.level > 1 && (
                            <div className="text-[9px] text-emerald-700 font-normal">Apontado: {numberBR(activity.actualAtomicHours, 1)}h</div>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${Number(activity.plannedHours || 0) - Number(activity.actualHours || 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{numberBR(Number(activity.plannedHours || 0) - Number(activity.actualHours || 0), 2)} h</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {activity.hoursOverrunStatus ? (
                            <Badge variant="outline" className="text-[9px] font-bold border-rose-300 bg-rose-50 text-rose-700">
                              {activity.hoursOverrunStatus}
                            </Badge>
                          ) : Number(activity.plannedHours || 0) > 0 && Number(activity.actualHours || 0) > Number(activity.plannedHours || 0) ? (
                            <Badge variant="outline" className="text-[9px] font-bold border-rose-300 bg-rose-50 text-rose-700">
                              Estouro (+{(((Number(activity.actualHours) - Number(activity.plannedHours)) / Number(activity.plannedHours)) * 100).toFixed(0)}%)
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-slate-400">Regular</span>
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[100px]"><div className="flex items-center gap-1"><Progress value={Number(activity.progressPct || 0)} className="h-1.5" /><span className="text-[10px] w-8 text-right">{numberBR(activity.progressPct, 0)}%</span></div></td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant="outline" className={`text-[10px] gap-1.5 ${statusClass(activity.status)}`}><span className={`h-2 w-2 rounded-full ${statusDotClass(activity.status)}`} />{statusLabel(activity.status)}</Badge>
                          {activity.sourceStatus && <div className="mt-1 text-[9px] text-slate-500">Fonte: {activity.sourceStatus}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 border-t-2 border-blue-200 bg-white/95 shadow-[0_-2px_8px_rgba(15,23,42,0.08)]">
                  <tr className="font-semibold text-[11px]">
                    <td colSpan={11} className="px-3 py-3 text-right text-slate-700">Totalizadores dos itens exibidos ({visibleActivities.length}) • soma somente Nível 1</td>
                    <td className="px-3 py-3 text-center text-slate-900 whitespace-nowrap">{numberBR(hoursTotals.planned, 2)} h</td>
                    <td className="px-3 py-3 text-center text-blue-900 whitespace-nowrap">{numberBR(hoursTotals.actual, 2)} h</td>
                    <td className={`px-3 py-3 text-center whitespace-nowrap ${hoursTotals.balance < 0 ? "text-rose-700" : "text-emerald-700"}`}>{numberBR(hoursTotals.balance, 2)} h</td>
                    <td className="px-3 py-3 text-center text-slate-500" colSpan={3}>{hoursTotals.overrunCount} com estouro</td>
                  </tr>
                </tfoot>
              </table>
              {visibleActivities.length === 0 && <div className="py-10 text-center text-xs text-slate-400">Nenhum item atende aos filtros da árvore.</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2"><History className="w-4 h-4 text-blue-900" />Evolução Semanal e Ocorrências</CardTitle><CardDescription className="text-xs">Ritos PMBOK de fechamento semanal do projeto</CardDescription></div>
          <Link href={`/apontamento-semanal?project=${project!.id}`}><Button size="sm" variant="outline" className="h-8 text-xs"><PlusCircle className="w-3.5 h-3.5 mr-1" />Novo check-in</Button></Link>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          {!weeklyUpdates?.length ? <div className="py-6 text-center text-xs text-slate-400">Nenhum apontamento semanal registrado ainda.</div> : weeklyUpdates.map((update) => (
            <div key={update.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5"><div className="flex items-center justify-between"><strong>{update.weekReference}</strong><Badge className={statusClass(update.ragStatus)}>RAG {update.ragStatus.toUpperCase()}</Badge></div><div><strong>O que ocorreu:</strong> {update.whatOccurred}</div><div><strong>Próximos passos:</strong> {update.nextSteps}</div></div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between"><div><CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-600" />Matriz de Riscos & Decisões</CardTitle><CardDescription className="text-xs">Quadro de gestão do projeto — apresentado ao final para priorizar o acompanhamento das atividades.</CardDescription></div><Link href={`/riscos-problemas?project=${project!.id}`}><Button size="sm" variant="outline" className="h-8 text-xs"><PlusCircle className="w-3.5 h-3.5 mr-1" />Adicionar</Button></Link></CardHeader>
        <CardContent className="p-4"><div className="grid grid-cols-1 lg:grid-cols-3 gap-3">{!risks?.length ? <div className="lg:col-span-3 py-6 text-center text-xs text-slate-400">Nenhum risco registrado para este projeto.</div> : risks.map((risk) => <div key={risk.id} className={`p-3 rounded-lg border text-xs space-y-1.5 ${risk.severity === "critico" ? "bg-rose-50 border-rose-200" : risk.severity === "alto" ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}><div className="flex justify-between gap-2 font-bold"><span>{risk.title}</span><Badge variant="outline" className="text-[10px] uppercase shrink-0">{risk.severity}</Badge></div><div className="text-slate-600"><strong>Impacto:</strong> {risk.impact}</div><div className="text-slate-600"><strong>Mitigação:</strong> {risk.mitigationPlan}</div></div>)}</div></CardContent>
      </Card>
    </div>
  );
}
