import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip as UiTooltip, TooltipContent as UiTooltipContent, TooltipTrigger as UiTooltipTrigger } from "@/components/ui/tooltip";
import { ProfileRole, useProfile } from "@/contexts/ProfileContext";
import { matchesProjectDateRange, sameFilterValue, useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Info,
  Layers,
  PlusCircle,
  Search,
  ShieldAlert,
  TrendingUp,
  UploadCloud,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "wouter";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { hasManagedHoursMetrics, hasManagedProductivityMetrics } from "@/lib/hoursMetrics";

function getProjectPlannedHours(project: { plannedHours?: unknown }) {
  return Number(project.plannedHours || 0);
}

function getProjectRealizedHours(project: {
  actualHours?: unknown;
  productiveActualHours?: unknown;
  hoursMetricsSource?: string | null;
  projectType?: string | null;
  projectTypeDescription?: string | null;
}) {
  return Number(project.actualHours ?? 0);
}

function getProjectHoursCompletionPct(project: {
  plannedHours?: unknown;
  actualHours?: unknown;
  productiveActualHours?: unknown;
  hoursMetricsSource?: string | null;
  projectType?: string | null;
  projectTypeDescription?: string | null;
}) {
  const planned = getProjectPlannedHours(project);
  if (planned <= 0) return null;
  return Math.min(100, (getProjectRealizedHours(project) / planned) * 100);
}

function getProjectUnproductivePct(project: {
  actualHours?: unknown;
  productiveActualHours?: unknown;
  unproductiveActualHours?: unknown;
  hoursMetricsSource?: string | null;
  projectType?: string | null;
  projectTypeDescription?: string | null;
}) {
  if (!hasManagedProductivityMetrics(project)) return null;
  const productive = Number(project.productiveActualHours ?? project.actualHours ?? 0);
  const unproductive = Number(project.unproductiveActualHours ?? 0);
  const total = productive + unproductive;
  return total > 0 ? (unproductive / total) * 100 : 0;
}

type ProjectSortKey =
  | "code"
  | "name"
  | "client"
  | "sponsor"
  | "startDate"
  | "plannedEndDate"
  | "actualStartDate"
  | "actualEndDate"
  | "daysToFinish"
  | "plannedHours"
  | "actualHours"
  | "completionPct";

type ProgressHistoryRow = {
  label: string;
  startDate: string;
  endDate: string;
  programado: number;
  realizado: number | null;
  horasRealizadas: number | null;
  fonteRealizado: "checkin_semanal" | "sem_base_temporal";
  projetos: number;
  checkins: number;
};

type UpcomingAlert = {
  activityId: number;
  projectId: number;
  projectCode: string;
  projectName: string;
  client: string;
  ppsaCode: string;
  description: string;
  plannedEnd: string;
  plannedEndLabel: string;
  businessDaysRemaining: number;
  progressPct: number;
  status: string;
};

// Helper de formatação de número com separador de milhar por ponto (padrão pt-BR)
function formatNumberBR(val: number | string | undefined | null, decimals: number = 0): string {
  if (val === undefined || val === null || val === "") return "0";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "0";
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatHoursAxis(value: number) {
  if (value >= 1000) return `${formatNumberBR(value / 1000, value >= 10000 ? 0 : 1)} mil h`;
  return `${formatNumberBR(value, 0)} h`;
}

function extractTrailingCode(value: unknown) {
  const text = String(value || "");
  const parenthesized = text.match(/\((\d+)\)\s*$/);
  if (parenthesized) return Number(parenthesized[1]);
  const suffix = text.match(/(?:^|\s)(\d+)\s*$/);
  return suffix ? Number(suffix[1]) : null;
}

function cleanOfficialLabel(value: unknown, fallback: string) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/\s*\(\d+\)\s*$/, "").replace(/\s+\d+\s*$/, "").trim() || fallback;
}

function compareOfficialCodes(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

export default function Home() {
  const { currentProfile } = useProfile();
  const {
    activeFilter,
    clientFilter,
    projectFilter,
    sponsorFilter,
    typeFilter,
    setTypeFilter,
    dateStart,
    dateEnd,
    search,
    setSearch,
  } = useGlobalFilters();


  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<ProjectSortKey>("code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedManagementCode, setSelectedManagementCode] = useState("todos");
  const pageSize = 15;

  const { data: allProjects = [], isLoading: loadingProjects } = trpc.projects.list.useQuery();
  const { data: openRisks = [] } = trpc.projects.getAllOpenRisks.useQuery();
  const { data: allActivities = [] } = trpc.projects.getAllActivities.useQuery();

  // Aplicação estrita de todos os Filtros Globais sobre o portfólio
  const filteredProjects = useMemo(() => {
    return allProjects.filter((p) => {
      // 1. Filtro Ativo (S/N)
      if (activeFilter === "ativo" && !p.isActive) return false;
      if (activeFilter === "inativo" && p.isActive) return false;

      // 2. Filtro por Cliente
      if (clientFilter !== "todos" && !sameFilterValue(p.client, clientFilter)) return false;

      // 3. Filtro por Projeto específico (código ou ID)
      if (projectFilter !== "todos" && String(p.id) !== projectFilter && p.code !== projectFilter) {
        return false;
      }

      // 4. Filtro por Gestor de Conta (Sponsor)
      if (sponsorFilter !== "todos" && !sameFilterValue(p.sponsor || "Não informado", sponsorFilter)) {
        return false;
      }

      // 5. Filtro por Tipo de Projeto
      const projectType = p.projectTypeDescription || p.projectType || "Não informado";
      if (typeFilter !== "todos" && !sameFilterValue(projectType, typeFilter)) {
        return false;
      }

      // 6. Filtro por período de análise: mantém projetos que atravessam a janela selecionada.
      if (!matchesProjectDateRange(p, dateStart, dateEnd)) return false;

      // 7. Busca textual livre
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchCode = p.code?.toLowerCase().includes(q);
        const matchName = p.name?.toLowerCase().includes(q);
        const matchClient = p.client?.toLowerCase().includes(q);
        const matchManager = p.managerName?.toLowerCase().includes(q);
        const matchSponsor = p.sponsor?.toLowerCase().includes(q);
        if (!matchCode && !matchName && !matchClient && !matchManager && !matchSponsor) {
          return false;
        }
      }

      return true;
    });
  }, [allProjects, activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd, search]);

  // SEÇÕES EXECUTIVAS DA ESPECIFICAÇÃO REV07
  const executiveSections = useMemo(() => {
    // 1. SAÚDE DOS PROJETOS
    const health = {
      verde: filteredProjects.filter((p) => p.status === "verde"),
      amarelo: filteredProjects.filter((p) => p.status === "amarelo"),
      vermelho: filteredProjects.filter((p) => p.status === "vermelho"),
    };

    // 2. PROJETOS CRÍTICOS (vermelho ou atraso cronológico ou estouro)
    const criticalProjects = filteredProjects
      .filter((p) => {
        const completion = getProjectHoursCompletionPct(p) ?? 0;
        const delayed = p.plannedEndDate && p.plannedEndDate !== "Sem data" && new Date(p.plannedEndDate).getTime() < Date.now() && completion < 100;
        const overrun = getProjectRealizedHours(p) > getProjectPlannedHours(p) && getProjectPlannedHours(p) > 0;
        return p.status === "vermelho" || delayed || overrun;
      })
      .slice(0, 8);

    // 3. RESUMO ÚNICO POR GESTÃO / MÓDULO
    const scopedIds = new Set(filteredProjects.map((p) => p.id));
    const scopedActivities = allActivities.filter((a) => scopedIds.has(a.projectId));
    const moduleByProject = new Map<string, {
      managementCode: number | null;
      managementName: string;
      moduleCode: number | null;
      moduleName: string;
      planned: number;
      actual: number;
      plannedEnd: string | null;
    }>();
    scopedActivities.forEach((a: any) => {
      const managementCode = a.managementCode != null ? Number(a.managementCode) : extractTrailingCode(a.managementName);
      const moduleCode = a.moduleCode != null ? Number(a.moduleCode) : extractTrailingCode(a.moduleName);
      const managementName = cleanOfficialLabel(a.managementName, managementCode != null ? `Gestão ${managementCode}` : "Gestão Geral");
      const moduleName = cleanOfficialLabel(a.moduleName, moduleCode != null ? `Módulo ${moduleCode}` : "Módulo Geral");
      const managementKey = managementCode != null ? String(managementCode) : managementName;
      const moduleKey = moduleCode != null ? String(moduleCode) : moduleName;
      const key = `${a.projectId}|${managementKey}|${moduleKey}`;
      const current = moduleByProject.get(key);
      const planned = Number(a.moduleSummaryPlannedHours ?? a.plannedModuleHours ?? (a.level === 1 ? a.plannedHours : 0));
      const actual = Number(a.moduleSummaryActualHours ?? a.moduleActualHours ?? (a.level === 1 ? a.actualHours : 0));
      const plannedEnd = a.plannedEnd && a.plannedEnd !== "Sem data" ? String(a.plannedEnd) : null;
      if (!current) {
        moduleByProject.set(key, { managementCode, managementName, moduleCode, moduleName, planned, actual, plannedEnd });
      } else {
        current.planned = Math.max(current.planned, planned);
        current.actual = Math.max(current.actual, actual);
        if (plannedEnd && (!current.plannedEnd || plannedEnd > current.plannedEnd)) current.plannedEnd = plannedEnd;
      }
    });

    const moduleMap = new Map<string, {
      managementCode: number | null;
      managementName: string;
      moduleCode: number | null;
      moduleName: string;
      planned: number;
      actual: number;
      delayDays: number;
      projectCount: number;
    }>();
    moduleByProject.forEach((module) => {
      const managementKey = module.managementCode != null ? String(module.managementCode) : module.managementName;
      const moduleKey = module.moduleCode != null ? String(module.moduleCode) : module.moduleName;
      const key = `${managementKey}|${moduleKey}`;
      const existing = moduleMap.get(key);
      const target = module.plannedEnd ? new Date(`${module.plannedEnd}T00:00:00`) : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const delayDays = target && !Number.isNaN(target.getTime()) ? Math.max(0, Math.round((today.getTime() - target.getTime()) / 86400000)) : 0;
      if (!existing) {
        moduleMap.set(key, {
          managementCode: module.managementCode,
          managementName: module.managementName,
          moduleCode: module.moduleCode,
          moduleName: module.moduleName,
          planned: module.planned,
          actual: module.actual,
          delayDays,
          projectCount: 1,
        });
      } else {
        existing.planned += module.planned;
        existing.actual += module.actual;
        existing.delayDays = Math.max(existing.delayDays, delayDays);
        existing.projectCount += 1;
      }
    });

    const managementOptions = Array.from(new Map(
      Array.from(moduleMap.values()).map((item) => [item.managementCode != null ? String(item.managementCode) : item.managementName, item.managementName]),
    ).entries())
      .map(([value, label]) => ({ value, label, code: Number.isFinite(Number(value)) ? Number(value) : null }))
      .sort((a, b) => compareOfficialCodes(a.code, b.code) || a.label.localeCompare(b.label, "pt-BR"));

    const managementModuleList = Array.from(moduleMap.values())
      .filter((item) => selectedManagementCode === "todos" || String(item.managementCode ?? item.managementName) === selectedManagementCode)
      .map((item) => {
        const pct = item.planned > 0 ? (item.actual / item.planned) * 100 : 0;
        const status = item.actual > item.planned && item.planned > 0
          ? "Estouro"
          : item.delayDays > 0 && item.actual < item.planned
          ? "Atrasado"
          : pct >= 80
          ? "Normal"
          : "Atenção";
        return { ...item, pct, status };
      })
      .sort((a, b) => compareOfficialCodes(a.managementCode, b.managementCode)
        || compareOfficialCodes(a.moduleCode, b.moduleCode)
        || a.moduleName.localeCompare(b.moduleName, "pt-BR"));

    // 4. PRÓXIMAS VIRADAS (projetos ativos mais próximos do encerramento previsto)
    const upcomingDeliveries = filteredProjects
      .filter((p) => p.isActive && p.plannedEndDate && p.plannedEndDate !== "Sem data")
      .map((p) => {
        const target = new Date(`${p.plannedEndDate}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.round((target.getTime() - today.getTime()) / 86400000);
        const pct = getProjectHoursCompletionPct(p) ?? 0;
        const situacao = days < 0 ? "Atrasado" : days <= 15 ? "Crítico" : "No Prazo";
        return { project: p, date: p.plannedEndDate, days, pct, situacao };
      })
      .sort((a, b) => a.days - b.days)
      .slice(0, 6);

    return { health, criticalProjects, managementOptions, managementModuleList, upcomingDeliveries };
  }, [filteredProjects, allActivities, selectedManagementCode]);

  useEffect(() => {
    if (selectedManagementCode !== "todos" && !executiveSections.managementOptions.some((option) => option.value === selectedManagementCode)) {
      setSelectedManagementCode("todos");
    }
  }, [executiveSections.managementOptions, selectedManagementCode]);

  const sortedProjects = useMemo(() => {
    const valueFor = (project: (typeof filteredProjects)[number]) => {
      if (sortKey === "code") return Number(project.code) || 0;
      if (sortKey === "plannedHours") return getProjectPlannedHours(project);
      if (sortKey === "actualHours") return getProjectRealizedHours(project);
      if (sortKey === "completionPct") return getProjectHoursCompletionPct(project) ?? -1;
      if (sortKey === "daysToFinish") {
        const target = project.plannedEndDate && project.plannedEndDate !== "Sem data" ? new Date(`${project.plannedEndDate}T00:00:00`).getTime() : null;
        if (!target || Number.isNaN(target)) return 999999;
        const today = new Date().setHours(0, 0, 0, 0);
        return Math.round((target - today) / 86400000);
      }
      if (sortKey === "actualStartDate") return String(project.actualStartDate || "");
      if (sortKey === "actualEndDate") return String(project.actualEndDate || "");
      return String(project[sortKey] || "").toLocaleLowerCase("pt-BR");
    };

    return [...filteredProjects].sort((left, right) => {
      const a = valueFor(left);
      const b = valueFor(right);
      const comparison = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredProjects, sortKey, sortDirection]);

  const toggleSort = (key: ProjectSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setPage(1);
  };

  const sortableHeader = (label: string, key: ProjectSortKey, className = "") => (
    <TableHead className={`text-xs font-bold text-slate-700 ${className}`}>
      <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-700 rounded">
        {label}
        {sortKey === key ? <span className="text-blue-700">{sortDirection === "asc" ? "↑" : "↓"}</span> : <ArrowDownUp className="w-3 h-3 text-slate-400" />}
      </button>
    </TableHead>
  );

  useEffect(() => {
    setPage(1);
  }, [filteredProjects]);

  // IDs dos projetos filtrados para isolar os riscos do escopo selecionado
  const filteredProjectIds = useMemo(() => {
    return new Set(filteredProjects.map((p) => p.id));
  }, [filteredProjects]);

  const scopedRisks = useMemo(() => {
    if (clientFilter === "todos" && projectFilter === "todos" && activeFilter === "todos") {
      return openRisks;
    }
    return openRisks.filter((r) => filteredProjectIds.has(r.projectId));
  }, [openRisks, filteredProjectIds, clientFilter, projectFilter, activeFilter]);

  const progressProjectIds = useMemo(
    () => filteredProjects.map((project) => project.id).sort((left, right) => left - right),
    [filteredProjects],
  );
  const progressHistoryInput = useMemo(
    () => ({ projectIds: progressProjectIds }),
    [progressProjectIds],
  );
  const { data: progressHistory = [], isLoading: progressHistoryLoading } = trpc.projects.getProgressHistory.useQuery(
    progressHistoryInput,
    { enabled: progressProjectIds.length > 0 },
  );
  const { data: upcomingAlerts = [], isLoading: upcomingAlertsLoading } = trpc.projects.getUpcomingAlerts.useQuery(
    progressHistoryInput,
    { enabled: progressProjectIds.length > 0 },
  );
  const hoursSummaryInput = useMemo(
    () => ({ projectIds: progressProjectIds, periodEnd: dateEnd || undefined }),
    [progressProjectIds, dateEnd],
  );
  const { data: hoursSummary } = trpc.projects.getHoursSummary.useQuery(
    hoursSummaryInput,
    { enabled: progressProjectIds.length > 0 },
  );
  const historyRows = progressHistory as ProgressHistoryRow[];
  const alertRows = upcomingAlerts as UpcomingAlert[];

  // KPIs calculados estritamente sobre os projetos filtrados
  const calculatedMetrics = useMemo(() => {
    const total = filteredProjects.length;
    const countVerde = filteredProjects.filter((p) => p.status === "verde").length;
    const countAmarelo = filteredProjects.filter((p) => p.status === "amarelo").length;
    const countVermelho = filteredProjects.filter((p) => p.status === "vermelho").length;
    const countSemClass = filteredProjects.filter((p) => p.status === "sem_classificacao").length;
    const countAtivos = filteredProjects.filter((p) => p.isActive).length;
    const countConcluidos = filteredProjects.filter((p) => !p.isActive || Number(p.completionPct || 0) >= 100).length;
    const countAtrasados = filteredProjects.filter((p) => {
      if (!p.isActive) return false;
      if (!p.plannedEndDate || p.plannedEndDate === "Sem data") return false;
      const target = new Date(`${p.plannedEndDate}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return target < today && Number(p.completionPct || 0) < 100;
    }).length;
    const countEmRisco = filteredProjects.filter((p) => p.status === "vermelho" || p.status === "amarelo").length;

    let totalActualHours = 0;
    let totalPlannedHours = 0;
    let totalProductiveActualHours = 0;
    let totalUnproductiveActualHours = 0;
    let totalPlannedInSchedule = 0;
    let totalPlannedOutsideSchedule = 0;
    let productivityMetricsProjects = 0;
    let scopeMetricsProjects = 0;
    let sumProgress = 0;

    filteredProjects.forEach((p) => {
      const hasManagedMetrics = hasManagedHoursMetrics(p);
      const prod = hasManagedMetrics && (p as any).productiveActualHours != null && Number((p as any).productiveActualHours) > 0
        ? parseFloat((p as any).productiveActualHours)
        : parseFloat(p.actualHours || "0");
      totalActualHours += prod;
      totalPlannedHours += getProjectPlannedHours(p);
      if (hasManagedProductivityMetrics(p)) {
        productivityMetricsProjects += 1;
        totalProductiveActualHours += prod;
        totalUnproductiveActualHours += Number((p as any).unproductiveActualHours || 0);
      }
      if ((p as any).plannedHoursInSchedule != null || (p as any).plannedHoursOutsideSchedule != null) {
        scopeMetricsProjects += 1;
        totalPlannedInSchedule += Number((p as any).plannedHoursInSchedule || 0);
        totalPlannedOutsideSchedule += Number((p as any).plannedHoursOutsideSchedule || 0);
      }
      sumProgress += getProjectHoursCompletionPct(p) ?? 0;
    });

    // O KPI principal permanece estável: ele usa sempre o total persistido do
    // projeto. O acumulado até a data do filtro é exibido separadamente para
    // não trocar o valor da tela quando a consulta assíncrona termina.
    const periodActualHours = hoursSummary?.actualHoursToDate ?? null;
    const periodPlannedHours = hoursSummary?.plannedHoursToDate ?? null;
    const hoursProgress = totalPlannedHours > 0 ? (totalActualHours / totalPlannedHours) * 100 : 0;
    const reportedProductivityHours = totalProductiveActualHours + totalUnproductiveActualHours;
    const unproductivePct = reportedProductivityHours > 0 ? (totalUnproductiveActualHours / reportedProductivityHours) * 100 : 0;
    return {
      total,
      countVerde,
      countAmarelo,
      countVermelho,
      countSemClass,
      countAtivos,
      countConcluidos,
      countAtrasados,
      countEmRisco,
      totalActualHours,
      totalPlannedHours,
      periodActualHours,
      periodPlannedHours,
      totalActualHoursProject: hoursSummary?.totalActualHours ?? totalActualHours,
      totalPlannedHoursProject: hoursSummary?.totalPlannedHours ?? totalPlannedHours,
      avgProgress: total > 0 ? (sumProgress / total).toFixed(1) : "0.0",
      hoursProgress,
      totalProductiveActualHours,
      totalUnproductiveActualHours,
      totalPlannedInSchedule,
      totalPlannedOutsideSchedule,
      unproductivePct,
      productivityMetricsProjects,
      scopeMetricsProjects,
      periodEnd: dateEnd || undefined,
    };
  }, [filteredProjects, dateEnd, hoursSummary]);

  // Ranking Top 10 com base nos projetos filtrados
  const top10Projects = useMemo(() => {
    const sorted = [...filteredProjects].sort((a, b) => {
      return getProjectRealizedHours(b) - getProjectRealizedHours(a);
    });
    return sorted.slice(0, 10);
  }, [filteredProjects]);

  const hoursByProjectType = useMemo(() => {
    const grouped = new Map<string, { type: string; hours: number; planned: number; projects: number }>();
    filteredProjects.forEach((project) => {
      const type = project.projectTypeDescription || project.projectType || "Não informado";
      const current = grouped.get(type) || { type, hours: 0, planned: 0, projects: 0 };
      current.hours += getProjectRealizedHours(project);
      current.planned += getProjectPlannedHours(project);
      current.projects += 1;
      grouped.set(type, current);
    });
    return Array.from(grouped.values())
      .map((item) => {
        const deviation = item.planned > 0 ? ((item.hours - item.planned) / item.planned) * 100 : null;
        const deviationHours = item.hours - item.planned;
        return {
          ...item,
          deviation,
          deviationHours,
          deviationText: deviation === null
            ? "Sem horas previstas"
            : `Δ ${deviationHours >= 0 ? "+" : ""}${formatNumberBR(deviationHours, 1)}h`,
        };
      })
      .sort((a, b) => b.hours - a.hours);
  }, [filteredProjects]);

  // Tags rápidas de tipos de projeto disponíveis no escopo atual
  const availableTypesInScope = useMemo(() => {
    const counts = new Map<string, number>();
    filteredProjects.forEach((project) => {
      const type = project.projectTypeDescription || project.projectType || "Não informado";
      counts.set(type, (counts.get(type) || 0) + 1);
    });
    return counts;
  }, [filteredProjects]);

  // Paginação da Tabela de Projetos
  const totalPages = Math.ceil(sortedProjects.length / pageSize) || 1;
  const paginatedProjects = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedProjects.slice(start, start + pageSize);
  }, [sortedProjects, page, pageSize]);

  const profileNames: Record<ProfileRole, string> = {
    diretoria: "Diretoria Executiva",
    pmo: "PMO Corporativo",
    gerente: "Gerente de Projetos",
    consultor: "Consultor Técnico",
    cliente: "Cliente / Sponsor Externo",
  };

  const profileDescriptions: Record<ProfileRole, string> = {
    diretoria: "Visão consolidada executiva de portfólio, horas apontadas e status geral.",
    pmo: "Governança metodológica PMBOK, baseline planejada, avanço ponderado e riscos.",
    gerente: "Gestão operacional e gerencial: evolução semanal, controle de módulos, alocação e riscos.",
    consultor: "Visão de alocações, cronograma de execução e apontamento de esforço.",
    cliente: "Acompanhamento transparente das entregas, status de fases e marcos contratuais.",
  };

  const reportSummaryRows = useMemo(() => filteredProjects.map((project) => {
    const planned = getProjectPlannedHours(project);
    const actual = getProjectRealizedHours(project);
    return {
      Código: project.code,
      Projeto: project.name,
      Cliente: project.client,
      Gestor: project.sponsor || "Não informado",
      Status: project.status,
      "Avanço programado": historyRows.at(-1)?.programado ?? 0,
      "Avanço calculado": planned > 0 ? Math.min(100, (actual / planned) * 100) : 0,
      "Avanço informado": Number(project.completionPct || 0),
      "Horas planejadas": planned,
      "Horas realizadas": actual,
      "Data inicial prevista": project.startDate || "Sem data",
      "Data final prevista": project.plannedEndDate || "Sem data",
      "Data inicial realizada": project.actualStartDate || "Sem data",
      "Data final realizada": project.actualEndDate || project.finalDate || "Sem data",
      "Dias a finalizar": project.plannedEndDate && project.plannedEndDate !== "Sem data"
        ? Math.round((new Date(`${project.plannedEndDate}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
        : null,
      "Data de escopo": project.scopeDate || "Sem data",
      "Data de finalização": project.finalDate || "Sem data",
      Fase: project.sourcePhaseCode || "Não informado",
      Segmento: project.segmentId ? `#${project.segmentId}` : "Não informado",
    };
  }), [filteredProjects, historyRows]);

  const exportStatusReportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(reportSummaryRows);
    const historySheet = XLSX.utils.json_to_sheet(historyRows.map((row) => ({
      Semana: row.label,
      Início: row.startDate,
      Término: row.endDate,
      "Avanço programado (%)": row.programado,
      "Avanço realizado (%)": row.realizado ?? "Sem base temporal",
      "Horas realizadas": row.horasRealizadas ?? "Sem base temporal",
      "Fonte do realizado": row.fonteRealizado === "checkin_semanal" ? "Check-in semanal" : "Sem data de apontamento",
      "Projetos no escopo": row.projetos,
      Checkins: row.checkins,
    })));
    const alertSheet = XLSX.utils.json_to_sheet(alertRows.map((alert) => ({
      Projeto: `#${alert.projectCode} - ${alert.projectName}`,
      Cliente: alert.client,
      PPSA: alert.ppsaCode,
      Atividade: alert.description,
      "Data final": alert.plannedEndLabel,
      "Dias úteis restantes": alert.businessDaysRemaining,
      "Avanço (%)": alert.progressPct,
      Status: alert.status,
    })));
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo PMBOK");
    XLSX.utils.book_append_sheet(workbook, historySheet, "Tendência 8 semanas");
    XLSX.utils.book_append_sheet(workbook, alertSheet, "Alertas de prazo");
    XLSX.writeFile(workbook, `status-report-cs-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportStatusReportPdf = () => {
    const document = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    let cursorY = 16;
    const dateLabel = new Date().toLocaleDateString("pt-BR");
    const numberPdf = (value: number, decimals = 1) => value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const truncate = (value: unknown, length: number) => {
      const text = String(value ?? "");
      return text.length > length ? `${text.slice(0, length - 1)}…` : text;
    };
    const ensureSpace = (height: number) => {
      if (cursorY + height > pageHeight - 12) {
        document.addPage();
        cursorY = 16;
      }
    };
    const sectionTitle = (title: string) => {
      ensureSpace(12);
      document.setFillColor(239, 246, 255);
      document.roundedRect(14, cursorY - 5, pageWidth - 28, 8, 1.5, 1.5, "F");
      document.setTextColor(30, 58, 138);
      document.setFontSize(10);
      document.setFont("helvetica", "bold");
      document.text(title, 17, cursorY);
      cursorY += 9;
    };
    const table = (headers: string[], rows: string[][], widths: number[]) => {
      const rowHeight = 6;
      const drawRow = (values: string[], header = false) => {
        ensureSpace(rowHeight + 2);
        let cursorX = 14;
        document.setFillColor(header ? 30 : 248, header ? 58 : 250, header ? 138 : 252);
        document.setDrawColor(226, 232, 240);
        document.rect(14, cursorY - 4.5, widths.reduce((sum, width) => sum + width, 0), rowHeight, "FD");
        values.forEach((value, index) => {
          document.setTextColor(header ? 255 : 30, header ? 255 : 41, header ? 255 : 59);
          document.setFontSize(header ? 7 : 6.5);
          document.setFont("helvetica", header ? "bold" : "normal");
          document.text(truncate(value, Math.max(8, Math.floor(widths[index]! / 1.55))), cursorX + 1.5, cursorY - 0.5);
          cursorX += widths[index]!;
          if (index < values.length - 1) document.line(cursorX, cursorY - 4.5, cursorX, cursorY + 1.5);
        });
        cursorY += rowHeight;
      };
      drawRow(headers, true);
      rows.forEach((row) => drawRow(row));
      cursorY += 3;
    };

    document.setTextColor(15, 23, 42);
    document.setFont("helvetica", "bold");
    document.setFontSize(18);
    document.text("Status Report Consolidado — Gestão 360°", 14, cursorY);
    cursorY += 7;
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    document.setTextColor(71, 85, 105);
    document.text(`CS Compusoftware • Emitido em ${dateLabel} • ${filteredProjects.length} projeto(s) no escopo filtrado`, 14, cursorY);
    cursorY += 9;
    document.text("Indicadores alinhados ao acompanhamento PMBOK: avanço programado, calculado por horas e informado no check-in.", 14, cursorY);
    cursorY += 9;

    sectionTitle("Resumo executivo do portfólio");
    table(
      ["Projetos", "Avanço médio informado", "Horas planejadas", "Horas realizadas", "Alertas próximos 7 dias úteis", "Riscos no escopo"],
      [[
        String(calculatedMetrics.total),
        `${numberPdf(Number(calculatedMetrics.avgProgress))}%`,
        `${numberPdf(calculatedMetrics.totalPlannedHours)} h`,
        `${numberPdf(calculatedMetrics.totalActualHours)} h`,
        String(alertRows.length),
        String(scopedRisks.length),
      ]],
      [28, 45, 38, 38, 55, 30],
    );

    sectionTitle("Tendência histórica — últimas 8 semanas");
    table(
      ["Semana", "Avanço programado", "Avanço realizado", "Horas realizadas", "Check-ins"],
      historyRows.map((row) => [row.label, `${numberPdf(row.programado)}%`, row.realizado == null ? "Sem base temporal" : `${numberPdf(row.realizado)}%`, row.horasRealizadas == null ? "Sem base temporal" : `${numberPdf(row.horasRealizadas)} h`, String(row.checkins)]),
      [45, 48, 48, 45, 30],
    );

    sectionTitle("Projetos no escopo aplicado");
    table(
      ["Código", "Projeto", "Cliente", "Status", "Prog.", "Calc.", "Inf.", "Horas P.", "Horas R.", "Data final prevista"],
      reportSummaryRows.map((row) => [
        `#${row.Código}`,
        String(row.Projeto),
        String(row.Cliente),
        String(row.Status),
        `${numberPdf(Number(row["Avanço programado"]))}%`,
        `${numberPdf(Number(row["Avanço calculado"]))}%`,
        `${numberPdf(Number(row["Avanço informado"]))}%`,
        `${numberPdf(Number(row["Horas planejadas"]))} h`,
        `${numberPdf(Number(row["Horas realizadas"]))} h`,
        String(row["Data final prevista"]),
      ]),
      [18, 55, 32, 25, 20, 20, 20, 28, 28, 25],
    );

    sectionTitle("Alertas de prazo — Nível 1 com vencimento nos próximos 7 dias úteis");
    if (alertRows.length === 0) {
      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      document.setTextColor(71, 85, 105);
      document.text("Nenhuma atividade de Nível 1 atende ao critério no escopo atual.", 15, cursorY);
      cursorY += 8;
    } else {
      table(
        ["Projeto", "PPSA", "Atividade", "Término", "Dias úteis", "Avanço", "Status"],
        alertRows.map((alert) => [
          `#${alert.projectCode}`,
          alert.ppsaCode,
          alert.description,
          alert.plannedEndLabel,
          String(alert.businessDaysRemaining),
          `${numberPdf(alert.progressPct)}%`,
          alert.status,
        ]),
        [25, 25, 80, 25, 25, 25, 30],
      );
    }
    document.setFontSize(7);
    document.setTextColor(100, 116, 139);
    document.text("Fonte: dados operacionais importados e check-ins semanais registrados na Gestão 360°. Valores de horas consolidados no Nível 1.", 14, pageHeight - 7);
    document.save(`status-report-cs-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Banner Institucional de Boas-Vindas com Identidade Visual CS Compusoftware */}
      <div className="bg-gradient-to-r from-[#072530] via-[#0B3848] to-[#16566D] border-l-4 border-l-[#CF142B] rounded-xl p-5 text-white shadow-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#CF142B] text-white rounded shadow-2xs">
              {profileNames[currentProfile]}
            </span>
            <span className="text-slate-200 text-xs font-semibold">• CS Compusoftware • Inteligência e produtividade</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Gestão Gerencial de Projetos
          </h1>
          <p className="text-xs sm:text-sm text-slate-200 max-w-2xl mt-1">
            {profileDescriptions[currentProfile]}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportStatusReportPdf} disabled={progressHistoryLoading || upcomingAlertsLoading} className="border-white/30 text-white hover:bg-white/10 hover:border-[#CF142B] text-xs h-8">
            <FileText className="w-3.5 h-3.5" />
            Status Report PDF
          </Button>
          <Button size="sm" variant="outline" onClick={exportStatusReportExcel} disabled={progressHistoryLoading || upcomingAlertsLoading} className="border-white/30 text-white hover:bg-white/10 hover:border-[#CF142B] text-xs h-8">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Status Report Excel
          </Button>
          <Link href="/apontamento-semanal">
            <Button size="sm" className="bg-[#CF142B] text-white hover:bg-[#A40F21] font-bold text-xs h-8 flex items-center gap-1.5 shadow-sm">
              <PlusCircle className="w-3.5 h-3.5" />
              Novo Check-in Semanal
            </Button>
          </Link>
          <Link href="/riscos-problemas">
            <Button size="sm" variant="outline" className="border-white/30 text-white hover:bg-white/10 text-xs h-8">
              Registrador Risco
            </Button>
          </Link>
        </div>
      </div>

      {/* COMPONENTE DE FILTROS GLOBAIS FIXO (COMPARTILHADO COM TODAS AS ABAS) */}
      <GlobalFilterBar showProjectSelector={true} />

      {/* TAGS RÁPIDAS DE TIPOS DE PROJETO */}
      {availableTypesInScope.size > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-xs font-bold text-slate-900">Tipos de projeto</div>
              <div className="text-[10px] text-slate-500">Clique em uma tag para filtrar rapidamente o portfólio.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setTypeFilter("todos");
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                typeFilter === "todos"
                  ? "border-blue-900 bg-blue-900 text-white shadow-xs"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-900"
              }`}
            >
              Todos os tipos
            </button>
            {Array.from(availableTypesInScope.entries()).map(([type, count]) => {
              const selected = typeFilter === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setTypeFilter(selected ? "todos" : type);
                    setPage(1);
                  }}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    selected
                      ? "border-emerald-700 bg-emerald-700 text-white shadow-xs"
                      : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800"
                  }`}
                >
                  {type} <span className="ml-1 opacity-75">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI CARDS CONSOLIDADOS (QUADRADOS QUE RESPEITAM RIGOROSAMENTE OS FILTROS) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
          <div className="text-xs font-bold text-slate-900 tracking-wide">GESTÃO DE PROJETOS</div>
          <div className="text-[11px] text-slate-500">Indicadores executivos do escopo filtrado</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="text-[10px] text-slate-500 font-semibold uppercase">Projetos Ativos</div>
            <div className="text-lg font-bold text-slate-900">{formatNumberBR(calculatedMetrics.countAtivos)}</div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
            <div className="text-[10px] text-amber-800 font-semibold uppercase">Em Risco</div>
            <div className="text-lg font-bold text-amber-900">{formatNumberBR(calculatedMetrics.countEmRisco)}</div>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-2.5">
            <div className="text-[10px] text-rose-800 font-semibold uppercase">Atrasados</div>
            <div className="text-lg font-bold text-rose-900">{formatNumberBR(calculatedMetrics.countAtrasados)}</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
            <div className="text-[10px] text-emerald-800 font-semibold uppercase">Concluídos</div>
            <div className="text-lg font-bold text-emerald-900">{formatNumberBR(calculatedMetrics.countConcluidos)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2.5">
            <div className="text-[10px] text-blue-900 font-semibold uppercase">% Evolução</div>
            <div className="text-lg font-bold text-blue-900">{formatNumberBR(calculatedMetrics.hoursProgress, 1)}%</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] text-slate-500 font-semibold uppercase">Horas Planejadas</div>
            <div className="text-lg font-bold text-slate-900">{formatNumberBR(calculatedMetrics.totalPlannedHours, 1)}h</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] text-slate-500 font-semibold uppercase">Horas Realizadas</div>
            <div className="text-lg font-bold text-blue-900">{formatNumberBR(calculatedMetrics.totalActualHours, 1)}h</div>
          </div>
          <div className={`rounded-lg border p-2.5 ${calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours >= 0 ? "border-emerald-200 bg-emerald-50/40 text-emerald-900" : "border-rose-200 bg-rose-50/40 text-rose-900"}`}>
            <div className="text-[10px] font-semibold uppercase">Saldo / Estouro</div>
            <div className="text-lg font-bold">{calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours >= 0 ? "+" : "−"}{formatNumberBR(Math.abs(calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours), 1)}h</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Portfólio Filtrado */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">Portfólio Filtrado</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center justify-between">
              {formatNumberBR(calculatedMetrics.total)}
              <span className="text-xs font-normal text-slate-400">Projetos</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
              <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                {calculatedMetrics.countVerde}
              </span>
              <span className="text-slate-300">•</span>
              <span className="flex items-center gap-1 text-amber-700 font-semibold">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                {calculatedMetrics.countAmarelo}
              </span>
              <span className="text-slate-300">•</span>
              <span className="flex items-center gap-1 text-slate-500 font-semibold">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                {calculatedMetrics.countSemClass} em carga
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Classificação de RAG segundo o PMBOK</p>
          </CardContent>
        </Card>

        {/* KPI 2: Avanço do plano operacional PPSA */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">Avanço do plano operacional — valores recebidos da API</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-900 flex items-center justify-between">
              {formatNumberBR(calculatedMetrics.hoursProgress, 1)}%
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <Progress value={Math.min(100, Math.max(0, calculatedMetrics.hoursProgress))} className="h-1.5 bg-slate-100" />
            <p className="text-[11px] text-slate-500 mt-2">
              Horas realizadas ÷ horas planejadas: <span className="font-semibold text-slate-700">{formatNumberBR(calculatedMetrics.totalActualHours, 1)}h ÷ {formatNumberBR(calculatedMetrics.totalPlannedHours, 1)}h</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Percentual do total do projeto recebido da API</p>
            {calculatedMetrics.periodEnd && calculatedMetrics.periodPlannedHours != null && calculatedMetrics.periodActualHours != null && (
              <p className="text-[10px] text-slate-400 mt-1">Acumulado até {calculatedMetrics.periodEnd.split("-").reverse().join("/")}: {formatNumberBR(calculatedMetrics.periodActualHours, 1)}h ÷ {formatNumberBR(calculatedMetrics.periodPlannedHours, 1)}h</p>
            )}
          </CardContent>
        </Card>

        {/* KPI 3: Horas do plano operacional */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">Horas do plano operacional — valores recebidos da API</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center justify-between">
              <span>{formatNumberBR(calculatedMetrics.totalPlannedHours, 1)}h <span className="text-blue-800">/ {formatNumberBR(calculatedMetrics.totalActualHours, 1)}h</span></span>
              <Clock className="w-4 h-4 text-blue-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-xs text-slate-600">
              Planejadas <span className="font-semibold text-slate-800">{formatNumberBR(calculatedMetrics.totalPlannedHours, 1)}h</span>
              <span className="mx-1 text-slate-300">•</span>
              Realizadas <span className="font-semibold text-blue-800">{formatNumberBR(calculatedMetrics.totalActualHours, 1)}h</span>
            </div>
            {calculatedMetrics.scopeMetricsProjects > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-600">
                <span>Planejadas dentro do escopo: <strong className="text-blue-800">{formatNumberBR(calculatedMetrics.totalPlannedInSchedule, 1)}h</strong></span>
                <span>Planejadas fora do escopo: <strong className="text-amber-800">{formatNumberBR(calculatedMetrics.totalPlannedOutsideSchedule, 1)}h</strong></span>
                {calculatedMetrics.productivityMetricsProjects > 0 ? (
                  <>
                    <span>Produtivas: <strong className="text-emerald-700">{formatNumberBR(calculatedMetrics.totalProductiveActualHours, 1)}h</strong></span>
                    <span>Improdutivas: <strong className="text-rose-700">{formatNumberBR(calculatedMetrics.totalUnproductiveActualHours, 1)}h</strong></span>
                  </>
                ) : (
                  <span className="col-span-2 text-slate-400">Produtividade oficial: não informada pela fonte</span>
                )}
              </div>
            )}
            <Badge variant="outline" className={`mt-2 text-[10px] ${calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo: {calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours >= 0 ? "+" : "−"}{formatNumberBR(Math.abs(calculatedMetrics.totalPlannedHours - calculatedMetrics.totalActualHours), 1)}h</Badge>
            <p className="text-[11px] text-slate-400 mt-2">
              Total do projeto • campos recebidos da API
              {calculatedMetrics.periodEnd && calculatedMetrics.periodPlannedHours != null && calculatedMetrics.periodActualHours != null && ` • acumulado até ${calculatedMetrics.periodEnd.split("-").reverse().join("/")}: ${formatNumberBR(calculatedMetrics.periodActualHours, 1)}h`}
            </p>
            {calculatedMetrics.productivityMetricsProjects > 0 ? (
              <UiTooltip>
                <UiTooltipTrigger asChild>
                  <span className="mt-2 inline-flex cursor-help items-center gap-1">
                    <Badge variant="outline" className={`text-[10px] ${calculatedMetrics.unproductivePct > 30 ? "border-rose-300 bg-rose-50 text-rose-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>
                      {calculatedMetrics.unproductivePct > 30 ? "Alerta: " : "Dentro do limite: "}{formatNumberBR(calculatedMetrics.unproductivePct, 1)}% improdutivas (limite 30%)
                    </Badge>
                    <Info className="h-3 w-3 text-slate-400" />
                  </span>
                </UiTooltipTrigger>
                <UiTooltipContent className="max-w-xs text-[11px] leading-4">
                  Desvio de produtividade = horas improdutivas ÷ (horas produtivas + horas improdutivas). Acima de 30% recebe alerta vermelho e requer avaliação gerencial.
                </UiTooltipContent>
              </UiTooltip>
            ) : (
              <p className="text-[10px] text-slate-400 mt-1">A fonte não traz produtividade oficial separada; o detalhe mantém o realizado e o escopo do planejamento sem inventar improdutividade.</p>
            )}
          </CardContent>
        </Card>

        {/* KPI 4: Riscos Críticos do Escopo */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs text-slate-500 font-medium">Riscos Críticos & Decisões</CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-600 flex items-center justify-between">
              {scopedRisks.filter((r) => r.severity === "alto" || r.severity === "critico").length}
              <ShieldAlert className="w-4 h-4 text-rose-600" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-1">
            <div className="text-xs text-slate-600">
              Total de <span className="font-semibold text-slate-800">{scopedRisks.length}</span> riscos no filtro atual
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Exigem decisão da Gestão / Sponsor</p>
          </CardContent>
        </Card>
      </div>

      {/* GRÁFICOS COMPARATIVOS DO PORTFÓLIO — lado a lado em telas amplas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
      {/* GRÁFICO: DISTRIBUIÇÃO DE HORAS APONTADAS POR TIPO DE PROJETO COM CLIQUE */}
      <Card className="border-slate-200/80 shadow-xs h-full">
        <CardHeader className="p-4 pb-2 border-b border-slate-100">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-700" />
            Distribuição de Horas Realizadas por Tipo de Projeto
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 mt-0.5">
            Horas consolidadas no nível 1. Clique em uma barra para filtrar a tabela. A cor da barra identifica o desvio: realizado − previsto.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          {hoursByProjectType.length === 0 ? (
            <div className="h-[340px] flex items-center justify-center text-xs text-slate-400">
              Nenhuma hora apontada encontrada para a combinação de filtros selecionada.
            </div>
          ) : (
            <>
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={hoursByProjectType}
                  margin={{ top: 25, right: 30, left: 20, bottom: 35 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="type"
                    tick={{ fontSize: 11, fill: "#475569" }}
                    interval={0}
                    angle={-10}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => formatHoursAxis(Number(v))}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]?.payload) return null;
                      const item = payload[0].payload as (typeof hoursByProjectType)[number];
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                          <div className="font-semibold text-slate-900">{item.type}</div>
                          <div className="text-slate-500">{item.projects} projeto(s)</div>
                          <div className="mt-1 text-blue-900">Horas Realizadas: <strong>{formatNumberBR(item.hours, 1)}h</strong></div>
                          <div className="text-slate-700">Horas Previstas: <strong>{formatNumberBR(item.planned, 1)}h</strong></div>
                          <div className="mt-1 border-t border-slate-100 pt-1 text-amber-700">Desvio de horas: <strong>{item.deviationText}</strong></div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="hours"
                    radius={[6, 6, 0, 0]}
                    cursor="pointer"
                    onClick={(entry) => {
                      const clickedType = entry?.payload?.type || entry?.type;
                      if (clickedType) {
                        setTypeFilter(typeFilter === clickedType ? "todos" : clickedType);
                        setPage(1);
                      }
                    }}
                  >
                    {hoursByProjectType.map((entry) => (
                      <Cell
                        key={entry.type}
                        fill={typeFilter === entry.type
                          ? "#0f766e"
                          : entry.deviationHours > 0
                            ? "#dc2626"
                            : "#2563eb"}
                      />
                    ))}
                    <LabelList
                      dataKey="deviationText"
                      position="top"
                      style={{ fontSize: 10, fill: "#0f172a", fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Dentro/abaixo do previsto</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" />Estouro de horas</span>
              <span className="text-slate-400">Previsto disponível no tooltip</span>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* GRÁFICO: TOP 10 PROJETOS POR HORAS PREVISTAS X REALIZADAS */}
      <Card className="border-slate-200/80 shadow-xs h-full">
        <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-900" />
              Top 10 Projetos — Horas Previstas x Horas Realizadas
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Comparativo do escopo filtrado. O eixo inferior identifica cada projeto por código, cliente e nome.
            </CardDescription>
          </div>
              <span className="text-xs text-slate-400 font-mono">
            Top 10 de {filteredProjects.length} projeto(s) no filtro atual
          </span>
        </CardHeader>
        <CardContent className="p-4">
          {top10Projects.length === 0 ? (
            <div className="h-[340px] flex items-center justify-center text-xs text-slate-400">
              Nenhum projeto encontrado para o filtro selecionado.
            </div>
          ) : (
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top10Projects.map((p) => ({
                    code: `#${p.code}`,
                    name: `${p.name.slice(0, 18)}...`,
                    actual: getProjectRealizedHours(p),
                    planned: getProjectPlannedHours(p),
                    fullName: p.name,
                    client: p.client,
                  }))}
                  margin={{ top: 10, right: 30, left: 10, bottom: 82 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="code"
                    height={82}
                    interval={0}
                    tick={(props: any) => {
                      const item = top10Projects[props?.payload?.index];
                      if (!item) return <g />;
                      const client = String(item.client || "Não informado").slice(0, 16);
                      const name = String(item.name || "").slice(0, 20);
                      return (
                        <g transform={`translate(${props.x},${props.y})`}>
                          <text x={0} y={0} dy={12} textAnchor="middle" fill="#1e3a8a" fontSize={10} fontWeight={700}>
                            #{item.code}
                          </text>
                          <text x={0} y={0} dy={27} textAnchor="middle" fill="#475569" fontSize={9}>
                            {client}
                          </text>
                          <text x={0} y={0} dy={41} textAnchor="middle" fill="#64748b" fontSize={8}>
                            {name}{String(item.name || "").length > 20 ? "…" : ""}
                          </text>
                        </g>
                      );
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => formatHoursAxis(Number(v))}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]?.payload) return null;
                      const item = payload[0].payload as { code: string; fullName: string; client: string; planned: number; actual: number };
                      const difference = item.actual - item.planned;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs min-w-[220px]">
                          <div className="font-semibold text-slate-900">{item.code} — {item.fullName}</div>
                          <div className="text-slate-500 mb-1">Cliente: {item.client || "Não informado"}</div>
                          <div className="text-slate-700">Horas Previstas: <strong>{formatNumberBR(item.planned, 1)}h</strong></div>
                          <div className="text-blue-900">Horas Realizadas: <strong>{formatNumberBR(item.actual, 1)}h</strong></div>
                          <div className="mt-1 border-t border-slate-100 pt-1 text-amber-700">Desvio de horas: <strong>{difference >= 0 ? "+" : ""}{formatNumberBR(difference, 1)}h</strong></div>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <Bar dataKey="planned" name="Horas previstas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" name="Horas realizadas" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.9fr)] gap-4">
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2 border-b border-slate-100">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-700" />
              Tendência histórica — últimas 8 semanas
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Evolução semanal do avanço programado. O realizado por horas só é exibido quando existe apontamento de horas com semana de referência explícita.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {progressHistoryLoading ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400">Calculando histórico...</div>
            ) : historyRows.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-slate-400">Nenhum projeto atende aos filtros aplicados.</div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyRows} margin={{ top: 12, right: 18, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#475569" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(value) => `${value}%`} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]?.payload) return null;
                        const row = payload[0].payload as ProgressHistoryRow;
                        return (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
                            <div className="font-semibold text-slate-900">{row.label}</div>
                            <div className="text-amber-700">Programado: <strong>{formatNumberBR(row.programado, 1)}%</strong></div>
                            <div className="text-blue-800">Realizado: <strong>{row.realizado == null ? "Sem base temporal" : `${formatNumberBR(row.realizado, 1)}%`}</strong></div>
                            <div className="mt-1 border-t border-slate-100 pt-1 text-slate-500">Horas realizadas: {row.horasRealizadas == null ? "Sem base temporal" : `${formatNumberBR(row.horasRealizadas, 1)}h`} • {row.checkins} check-in(s)</div>
                          </div>
                        );
                      }}
                    />
                    <Legend formatter={(value: string) => value === "programado" ? "Programado" : "Realizado por horas (check-in)"} />
                    <Line type="monotone" dataKey="programado" name="programado" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }}>
                      <LabelList dataKey="programado" position="top" formatter={(val: any) => `${formatNumberBR(val, 1)}%`} style={{ fontSize: 9, fontWeight: 700, fill: "#b45309" }} />
                    </Line>
                    {historyRows.some((row) => row.realizado != null) && (
                      <Line type="monotone" dataKey="realizado" name="realizado" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} connectNulls={false}>
                        <LabelList dataKey="realizado" position="bottom" formatter={(val: any) => val == null ? "" : `${formatNumberBR(val, 1)}%`} style={{ fontSize: 9, fontWeight: 700, fill: "#1d4ed8" }} />
                      </Line>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {!progressHistoryLoading && historyRows.length > 0 && historyRows.every((row) => row.realizado == null) && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-900">
                <strong>Realizado por horas indisponível na série:</strong> a API entrega o total consolidado do projeto, mas não entrega a data de cada apontamento. Para não redistribuir esse total pelas semanas, o gráfico mostra somente o programado até que um check-in semanal registre horas consumidas e uma semana de referência.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={alertRows.length > 0 ? "border-rose-300 bg-rose-50/40 shadow-xs" : "border-slate-200/80 shadow-xs"}>
          <CardHeader className="p-4 pb-2 border-b border-slate-100">
            <CardTitle className={`text-base font-bold flex items-center gap-2 ${alertRows.length > 0 ? "text-rose-900" : "text-slate-900"}`}>
              <AlertTriangle className={`w-4 h-4 ${alertRows.length > 0 ? "text-rose-600" : "text-amber-600"}`} />
              Alertas de prazo
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Nível 1 com vencimento nos próximos 7 dias úteis.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {upcomingAlertsLoading ? (
              <div className="py-10 text-center text-xs text-slate-400">Verificando prazos...</div>
            ) : alertRows.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
                <p className="mt-2 text-xs font-semibold text-emerald-800">Nenhum alerta no escopo atual</p>
                <p className="mt-1 text-[10px] text-slate-500">As atividades de Nível 1 não vencem nos próximos 7 dias úteis.</p>
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {alertRows.map((alert) => (
                  <Link key={alert.activityId} href={`/projeto/${alert.projectId}`}>
                    <div className="cursor-pointer rounded-lg border border-rose-200 bg-white p-2.5 transition hover:border-rose-400 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-bold text-slate-900">#{alert.projectCode} • {alert.ppsaCode}</div>
                          <div className="truncate text-[11px] font-semibold text-slate-700">{alert.description}</div>
                        </div>
                        <Badge className="shrink-0 border-rose-200 bg-rose-100 text-[10px] text-rose-800">{alert.businessDaysRemaining === 0 ? "Hoje" : `${alert.businessDaysRemaining} d.u.`}</Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Vencimento: <strong className="text-rose-700">{alert.plannedEndLabel}</strong></span>
                        <span>Avanço: <strong>{formatNumberBR(alert.progressPct, 1)}%</strong></span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>


      {/* SEÇÕES EXECUTIVAS ADICIONAIS CONFORME ESPECIFICAÇÃO REV07 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Bloco 1: SAÚDE DOS PROJETOS */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2 border-b border-slate-100">
            <CardTitle className="text-xs font-bold text-slate-900 tracking-wide uppercase flex items-center justify-between">
              Saúde dos Projetos
              <span className="text-[10px] font-normal text-slate-400">PMBOK</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/70 border border-emerald-100">
              <span className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                No Prazo / Saudável
              </span>
              <span className="text-xs font-bold text-emerald-800">{executiveSections.health.verde.length}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/70 border border-amber-100">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Atenção Gerencial
              </span>
              <span className="text-xs font-bold text-amber-800">{executiveSections.health.amarelo.length}</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50/70 border border-rose-100">
              <span className="text-xs font-semibold text-rose-900 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                Crítico / Atrasado
              </span>
              <span className="text-xs font-bold text-rose-800">{executiveSections.health.vermelho.length}</span>
            </div>
          </CardContent>
        </Card>

        {/* Bloco 2: PROJETOS CRÍTICOS */}
        <Card className="border-slate-200/80 shadow-xs md:col-span-1 xl:col-span-3">
          <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-bold text-slate-900 tracking-wide uppercase">
              Projetos Críticos (Atraso, Estouro ou RAG Vermelho)
            </CardTitle>
            <span className="text-[10px] text-slate-400">Top {executiveSections.criticalProjects.length}</span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-48">
              <Table>
                <TableHeader className="bg-slate-50/70">
                  <TableRow className="text-[10px]">
                    <TableHead className="py-1 text-slate-700">Projeto</TableHead>
                    <TableHead className="py-1 text-slate-700">Cliente</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">% Avanço</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">Prazo</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">Horas (Plan / Real)</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">Risco</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executiveSections.criticalProjects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4 text-xs text-slate-400">
                        Nenhum projeto crítico no filtro atual.
                      </TableCell>
                    </TableRow>
                  ) : (
                    executiveSections.criticalProjects.map((p) => {
                      const pct = getProjectHoursCompletionPct(p) ?? 0;
                      return (
                        <TableRow key={p.id} className="text-xs hover:bg-rose-50/30">
                          <TableCell className="font-semibold text-slate-900 py-1.5 truncate max-w-[200px]">
                            <Link href={`/projeto/${p.id}`} className="hover:underline text-blue-900">
                              #{p.code} {p.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 py-1.5">{p.client}</TableCell>
                          <TableCell className="text-center py-1.5 font-bold text-slate-800">{formatNumberBR(pct, 1)}%</TableCell>
                          <TableCell className="text-center py-1.5 text-slate-600">{p.plannedEndDate && p.plannedEndDate !== "Sem data" ? p.plannedEndDate.split("-").reverse().join("/") : "Sem data"}</TableCell>
                          <TableCell className="text-center py-1.5 text-slate-600">{formatNumberBR(getProjectPlannedHours(p), 0)}h / {formatNumberBR(getProjectRealizedHours(p), 0)}h</TableCell>
                          <TableCell className="text-center py-1.5">
                            <Badge variant="outline" className={`text-[9px] ${p.status === "vermelho" ? "border-rose-300 bg-rose-100 text-rose-800" : "border-amber-300 bg-amber-100 text-amber-800"}`}>
                              {p.status === "vermelho" ? "Crítico" : "Alerta"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bloco 3: RESUMO ÚNICO POR GESTÃO / MÓDULO */}
        <Card className="border-slate-200/80 shadow-xs md:col-span-2">
          <CardHeader className="p-4 pb-2 border-b border-slate-100">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xs font-bold text-slate-900 tracking-wide uppercase">
                  Resumo por Gestão / Módulo
                </CardTitle>
                <CardDescription className="mt-0.5 text-[10px] text-slate-500">
                  Uma linha oficial por módulo, organizada pelos códigos da API. O projeto permanece definido no filtro global acima.
                </CardDescription>
              </div>
              <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-600">
                Analisar Gestão
                <select
                  value={selectedManagementCode}
                  onChange={(event) => setSelectedManagementCode(event.target.value)}
                  className="h-8 min-w-[170px] rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-300"
                  aria-label="Selecionar gestão para análise"
                >
                  <option value="todos">Todas as gestões</option>
                  {executiveSections.managementOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.code != null ? `${option.code} — ` : ""}{option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-64">
              <Table>
                <TableHeader className="bg-slate-50/90">
                  <TableRow className="text-[10px]">
                    <TableHead className="py-1.5 text-slate-700">Cód. Gestão</TableHead>
                    <TableHead className="py-1.5 text-slate-700">Gestão</TableHead>
                    <TableHead className="py-1.5 text-slate-700">Cód. Módulo</TableHead>
                    <TableHead className="py-1.5 text-slate-700">Módulo</TableHead>
                    <TableHead className="py-1.5 text-center text-slate-700">Plan.</TableHead>
                    <TableHead className="py-1.5 text-center text-slate-700">Real.</TableHead>
                    <TableHead className="py-1.5 text-center text-slate-700">%</TableHead>
                    <TableHead className="py-1.5 text-center text-slate-700">Status</TableHead>
                    <TableHead className="py-1.5 text-center text-slate-700">Atraso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executiveSections.managementModuleList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-5 text-center text-xs text-slate-400">
                        Nenhum módulo encontrado para a Gestão e os filtros globais selecionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    executiveSections.managementModuleList.map((item) => (
                      <TableRow key={`${item.managementCode ?? item.managementName}-${item.moduleCode ?? item.moduleName}`} className="text-xs hover:bg-blue-50/40">
                        <TableCell className="py-1.5 font-mono font-bold text-blue-950">{item.managementCode ?? "—"}</TableCell>
                        <TableCell className="max-w-[150px] truncate py-1.5 font-semibold text-slate-800">{item.managementName}</TableCell>
                        <TableCell className="py-1.5 font-mono font-bold text-violet-950">{item.moduleCode ?? "—"}</TableCell>
                        <TableCell className="max-w-[170px] truncate py-1.5 font-medium text-slate-700">{item.moduleName}</TableCell>
                        <TableCell className="py-1.5 text-center text-slate-600">{formatNumberBR(item.planned, 0)}h</TableCell>
                        <TableCell className="py-1.5 text-center font-bold text-blue-900">{formatNumberBR(item.actual, 0)}h</TableCell>
                        <TableCell className="py-1.5 text-center font-semibold text-slate-700">{formatNumberBR(item.pct, 1)}%</TableCell>
                        <TableCell className="py-1.5 text-center">
                          <Badge variant="outline" className={`text-[9px] ${item.status === "Estouro" ? "border-rose-300 bg-rose-50 text-rose-700" : item.status === "Atrasado" ? "border-amber-300 bg-amber-50 text-amber-700" : item.status === "Atenção" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1.5 text-center font-bold text-rose-700">{item.delayDays > 0 ? `${item.delayDays}d` : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Bloco 5: PRÓXIMAS VIRADAS */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-4 pb-2 border-b border-slate-100">
            <CardTitle className="text-xs font-bold text-slate-900 tracking-wide uppercase">
              Próximas Viradas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-56">
              <Table>
                <TableHeader className="bg-slate-50/70">
                  <TableRow className="text-[10px]">
                    <TableHead className="py-1 text-slate-700">Projeto</TableHead>
                    <TableHead className="py-1 text-slate-700">Cliente</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">Data</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">%</TableHead>
                    <TableHead className="py-1 text-center text-slate-700">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executiveSections.upcomingDeliveries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4 text-xs text-slate-400">
                        Nenhuma virada próxima agendada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    executiveSections.upcomingDeliveries.map((u) => (
                      <TableRow key={u.project.id} className="text-xs">
                        <TableCell className="font-semibold text-slate-800 py-1.5 truncate max-w-[120px]">
                          <Link href={`/projeto/${u.project.id}`} className="hover:underline text-blue-900">
                            #{u.project.code}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 py-1.5 truncate max-w-[100px]">{u.project.client}</TableCell>
                        <TableCell className="text-center py-1.5 text-slate-600">{u.date.split("-").reverse().join("/")}</TableCell>
                        <TableCell className="text-center py-1.5 font-bold text-slate-800">{formatNumberBR(u.pct, 1)}%</TableCell>
                        <TableCell className="text-center py-1.5">
                          <Badge variant="outline" className={`text-[9px] ${u.situacao === "Atrasado" ? "border-rose-300 bg-rose-50 text-rose-700" : u.situacao === "Crítico" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>
                            {u.situacao}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TABELA GERENCIAL POR PROJETO */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-900" />
              Visão Gerencial por Projeto (CS Compusoftware)
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              {filteredProjects.length} projeto(s) no filtro atual • Linhas em vermelho claro indicam projetos em atraso cronológico
            </CardDescription>
          </div>

          <div className="relative w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <Input
              placeholder="Buscar por código, cliente, gestor..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 h-8 text-xs bg-slate-50 border-slate-200"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/70 border-b border-slate-200">
                <TableRow>
                  {sortableHeader("Código", "code", "w-16")}
                  {sortableHeader("Projeto", "name")}
                  {sortableHeader("Cliente", "client")}
                  {sortableHeader("Gestor da Conta", "sponsor")}
                  {sortableHeader("Data Inicial (Previsto)", "startDate", "text-center")}
                  {sortableHeader("Data Final Prevista", "plannedEndDate", "text-center")}
                  {sortableHeader("Data Inicial Realizada", "actualStartDate", "text-center")}
                  {sortableHeader("Data Final Realizada", "actualEndDate", "text-center")}
                  {sortableHeader("Qtd Dias a Finalizar", "daysToFinish", "text-center")}
                  {sortableHeader("Horas Previstas", "plannedHours", "text-center")}
                  {sortableHeader("Horas Realizadas", "actualHours", "text-center")}
                  {sortableHeader("Avanço Físico", "completionPct", "text-center")}
                  <TableHead className="text-xs font-bold text-slate-700 text-right pr-6">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingProjects ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-xs text-slate-400">
                      Carregando dados dos projetos...
                    </TableCell>
                  </TableRow>
                ) : paginatedProjects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-xs text-slate-400">
                      Nenhum projeto encontrado com os filtros aplicados.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedProjects.map((project) => {
                    const plannedEndDateDisplay = project.plannedEndDate && project.plannedEndDate !== "Sem data" ? project.plannedEndDate : "Sem data";
                    const projectUnproductivePct = getProjectUnproductivePct(project);
                    const projectHoursCompletionPct = getProjectHoursCompletionPct(project);

                    const targetDate = plannedEndDateDisplay !== "Sem data" ? new Date(`${plannedEndDateDisplay}T00:00:00`) : null;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const daysToFinish = targetDate && !isNaN(targetDate.getTime())
                      ? Math.round((targetDate.getTime() - today.getTime()) / 86400000)
                      : null;

                    const delayed =
                      plannedEndDateDisplay !== "Sem data" &&
                      new Date(plannedEndDateDisplay).getTime() < Date.now() &&
                      (projectHoursCompletionPct ?? 0) < 100;

                    return (
                      <TableRow
                        key={project.id}
                        className={`hover:bg-blue-50/40 transition-colors ${delayed ? "bg-rose-50/20" : ""}`}
                      >
                        {/* Código */}
                        <TableCell className="font-mono text-xs font-bold text-slate-900">
                          <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                            #{project.code}
                          </span>
                        </TableCell>

                        {/* Nome do Projeto e Tipo */}
                        <TableCell className="max-w-[280px]">
                          <div className="font-semibold text-xs text-slate-900 truncate">
                            {project.name}
                          </div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="font-medium text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100">
                              {project.projectTypeDescription || project.projectType || "Sem tipo"}
                            </span>
                          </div>
                        </TableCell>

                        {/* Cliente */}
                        <TableCell className="text-xs font-medium text-slate-700">
                          {project.client}
                        </TableCell>

                        {/* Gestor da Conta */}
                        <TableCell className="text-xs text-slate-700">
                          {project.sponsor || "Não informado"}
                        </TableCell>

                        {/* Data Início */}
                        <TableCell className="text-center text-xs text-slate-600">
                          {project.startDate && project.startDate !== "Sem data"
                            ? project.startDate.split("-").reverse().join("/")
                            : <span className="text-slate-400 text-[10px]">Sem data</span>}
                        </TableCell>

                        {/* Data Final */}
                        <TableCell className="text-center text-xs">
                          {plannedEndDateDisplay === "Sem data" ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-semibold">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              Sem data prevista
                            </span>
                          ) : (
                            <>
                              <span className={delayed ? "text-rose-800 font-bold" : "text-slate-700"}>
                                {plannedEndDateDisplay.split("-").reverse().join("/")}
                              </span>
                              {project.finalDate && project.finalDate !== "Sem data" && (
                                <span className="block text-[9px] text-emerald-700 mt-0.5">Finalizado: {project.finalDate.split("-").reverse().join("/")}</span>
                              )}
                            </>
                          )}
                        </TableCell>

                        {/* Data Inicial Realizada */}
                        <TableCell className="text-center text-xs text-slate-600">
                          {project.actualStartDate && project.actualStartDate !== "Sem data"
                            ? project.actualStartDate.split("-").reverse().join("/")
                            : <span className="text-slate-400 text-[10px]">Sem data</span>}
                        </TableCell>

                        {/* Data Final Realizada */}
                        <TableCell className="text-center text-xs text-slate-600">
                          {project.actualEndDate && project.actualEndDate !== "Sem data"
                            ? project.actualEndDate.split("-").reverse().join("/")
                            : project.finalDate && project.finalDate !== "Sem data"
                            ? project.finalDate.split("-").reverse().join("/")
                            : <span className="text-slate-400 text-[10px]">Sem data</span>}
                        </TableCell>

                        {/* Qtd Dias a Finalizar */}
                        <TableCell className="text-center text-xs">
                          {daysToFinish === null ? (
                            <span className="text-slate-400 text-[10px]">Sem data</span>
                          ) : daysToFinish < 0 ? (
                            <Badge variant="outline" className="text-[10px] font-bold border-rose-300 bg-rose-50 text-rose-700">
                              Atrasado há {Math.abs(daysToFinish)}d
                            </Badge>
                          ) : daysToFinish === 0 ? (
                            <Badge variant="outline" className="text-[10px] font-bold border-amber-300 bg-amber-50 text-amber-800">
                              Vence hoje
                            </Badge>
                          ) : (
                            <span className="font-semibold text-slate-700">{daysToFinish} dias</span>
                          )}
                        </TableCell>

                        {/* Horas Previstas */}
                        <TableCell className="text-center text-xs font-semibold text-amber-800">
                          {formatNumberBR(getProjectPlannedHours(project), 1)}h
                        </TableCell>

                        {/* Horas Apontadas */}
                        <TableCell className="text-center text-xs font-bold text-slate-900">
                          <div>{formatNumberBR(getProjectRealizedHours(project), 1)}h</div>
                          {hasManagedHoursMetrics(project) && <div className="text-[9px] font-medium text-blue-700">API</div>}
                          {projectUnproductivePct !== null && (
                            <UiTooltip>
                              <UiTooltipTrigger asChild>
                                <span className="mt-1 inline-flex cursor-help items-center">
                                  <Badge variant="outline" className={`px-1.5 py-0 text-[9px] ${projectUnproductivePct > 30 ? "border-rose-300 bg-rose-50 text-rose-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}>
                                    {projectUnproductivePct > 30 ? "Improdutividade alta" : "Produtividade controlada"}
                                  </Badge>
                                </span>
                              </UiTooltipTrigger>
                              <UiTooltipContent className="max-w-xs text-[11px] leading-4">
                                {formatNumberBR(projectUnproductivePct, 1)}% das horas realizadas são improdutivas. O limite gerencial é 30%; acima dele, a linha fica vermelha.
                              </UiTooltipContent>
                            </UiTooltip>
                          )}
                        </TableCell>

                        {/* Avanço Físico */}
                        <TableCell className="text-center">
                          <div className="inline-block w-16">
                            <div className="text-[10px] font-semibold text-slate-700 mb-0.5">
                              {projectHoursCompletionPct === null ? "Sem plano" : `${formatNumberBR(projectHoursCompletionPct, 1)}%`}
                            </div>
                            <Progress value={projectHoursCompletionPct ?? 0} className="h-1.5" />
                          </div>
                        </TableCell>

                        {/* Ações */}
                        <TableCell className="text-right pr-6">
                          <Link href={`/projeto/${project.id}`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-blue-900 hover:text-blue-950 hover:bg-blue-50 font-semibold gap-1"
                            >
                              Abrir
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <div>
                Página <strong>{page}</strong> de <strong>{totalPages}</strong> (Total de {filteredProjects.length} projetos)
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 text-xs"
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-7 text-xs"
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
