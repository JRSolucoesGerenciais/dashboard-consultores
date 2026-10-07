import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { matchesProjectDateRange, sameFilterValue, useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Grid3X3,
  Layers,
  List,
  MapPin,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SCurveSection } from "@/components/SCurveSection";
import { sumCanonicalActualHours, sumCanonicalPlannedHours } from "@shared/hierarchyHours";

type ActivityRow = {
  id: number;
  ppsaCode: string;
  description: string;
  moduleName: string;
  managementName: string | null;
  resource: string | null;
  plannedStart: string;
  plannedEnd: string;
  plannedHours: string;
  actualHours: string;
  progressPct: string;
  level: number;
  status: string;
  sourceCronogramId: number | null;
  visualPeriod: number | null;
};

type PeriodRow = {
  index: number;
  weekNumber: number;
  label: string;
  range: string;
  startDate: string;
  endDate: string;
  activities: number;
  completed: number;
  actualHours: number;
  plannedHours: number;
  plannedHoursToDate: number;
  actualHoursToDate: number;
  calculatedProgress: number;
  programmedProgress: number;
  informedProgress: number | null;
  lateActivities: number;
  progress: number;
  onsite: number;
  remote: number;
  state: string;
};

type SCurvePoint = {
  date: string;
  label: string;
  plannedHours: number;
  actualHours: number;
  plannedPct: number;
  actualPct: number;
};

const chartColors = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#94a3b8"];

function numberBR(value: unknown, decimals = 0) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dateBR(value: string | null | undefined) {
  if (!value || value === "Sem data") return "Sem data";
  const parts = value.split("-");
  return parts.length === 3 ? parts.reverse().join("/") : value;
}

function parseDate(value: string | null | undefined) {
  if (!value || value === "Sem data") return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function activityOverlapsWeek(activity: ActivityRow, period: PeriodRow) {
  const activityStart = parseDate(activity.plannedStart) || parseDate(activity.plannedEnd);
  const activityEnd = parseDate(activity.plannedEnd) || activityStart;
  const periodStart = parseDate(period.startDate);
  const periodEnd = parseDate(period.endDate);
  if (!activityStart || !activityEnd || !periodStart || !periodEnd) return false;
  return activityStart.getTime() <= periodEnd.getTime() && activityEnd.getTime() >= periodStart.getTime();
}

function statusLabel(status: string) {
  if (status === "concluido") return "Concluída";
  if (status === "em_andamento") return "Em andamento";
  if (status === "atrasado") return "Atrasada";
  if (status === "atencao" || status === "amarelo") return "Em atenção";
  return "Não iniciado";
}

function statusClass(status: string) {
  if (status === "concluido") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "em_andamento") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "atrasado") return "bg-rose-50 text-rose-700 border-rose-200";
  if (status === "atencao" || status === "amarelo") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusDot(status: string) {
  if (status === "concluido") return "bg-emerald-600";
  if (status === "em_andamento") return "bg-blue-600";
  if (status === "atrasado") return "bg-red-600";
  if (status === "atencao" || status === "amarelo") return "bg-amber-500";
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

function levelRowClass(level: number, status: string) {
  if (status === "atrasado") return "bg-rose-100/90 border-l-4 border-l-red-600";
  if (status === "atencao" || status === "amarelo") return "bg-amber-100/90 border-l-4 border-l-amber-500";
  if (level === 1) return "bg-sky-100/90 border-l-4 border-l-blue-600";
  if (level === 2) return "bg-violet-100/90 border-l-4 border-l-violet-600";
  return "bg-emerald-50/90 border-l-4 border-l-emerald-500";
}

function levelTextClass(level: number) {
  if (level === 1) return "text-blue-950";
  if (level === 2) return "text-violet-950";
  return "text-emerald-950";
}

function levelBadgeClass(level: number) {
  if (level === 1) return "border-blue-500 bg-sky-200 text-blue-950";
  if (level === 2) return "border-violet-500 bg-violet-200 text-violet-950";
  return "border-emerald-500 bg-emerald-100 text-emerald-900";
}

function ppsaParent(code: string) {
  const parts = code.split(".");
  let lastNonZero = -1;
  parts.forEach((part, index) => { if (Number(part) !== 0) lastNonZero = index; });
  if (lastNonZero <= 0) return null;
  for (let index = lastNonZero; index < parts.length; index += 1) parts[index] = "0";
  return parts.join(".");
}

function comparePpsa(left: ActivityRow, right: ActivityRow) {
  const a = left.ppsaCode.split(".").map((part) => Number(part) || 0);
  const b = right.ppsaCode.split(".").map((part) => Number(part) || 0);
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return left.level - right.level || left.id - right.id;
}

function formatPeriodLabel(range: string) {
  return range.replace(" – ", " - ");
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export default function VisualControl() {
  const {
    activeFilter,
    clientFilter,
    projectFilter,
    sponsorFilter,
    typeFilter,
    dateStart,
    dateEnd,
    setProjectFilter,
  } = useGlobalFilters();
  const { data: allProjects = [], isLoading: loadingProjects } = trpc.projects.list.useQuery();
  const [localModule, setLocalModule] = useState("todos");
  const [localConsultant, setLocalConsultant] = useState("todos");
  const [localStatus, setLocalStatus] = useState("todos");
  const [periodIndex, setPeriodIndex] = useState(0);
  const [weekWindowOffset, setWeekWindowOffset] = useState(0);
  const [monthFilter, setMonthFilter] = useState(currentMonthValue);
  const [activeTab, setActiveTab] = useState<"cronograma" | "modulos" | "atividades" | "ppsa">("cronograma");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const scopedProjects = useMemo(() => allProjects.filter((project) => {
    if (activeFilter === "ativo" && !project.isActive) return false;
    if (activeFilter === "inativo" && project.isActive) return false;
    if (clientFilter !== "todos" && !sameFilterValue(project.client, clientFilter)) return false;
    if (projectFilter !== "todos" && String(project.id) !== projectFilter && project.code !== projectFilter) return false;
    if (sponsorFilter !== "todos" && !sameFilterValue(project.sponsor || "Não informado", sponsorFilter)) return false;
    if (typeFilter !== "todos" && !sameFilterValue(project.projectTypeDescription || project.projectType || "Não informado", typeFilter)) return false;
    return matchesProjectDateRange(project, dateStart, dateEnd);
  }), [allProjects, activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd]);

  const currentProject = useMemo(() => {
    if (projectFilter !== "todos") {
      return scopedProjects.find((project) => String(project.id) === projectFilter || project.code === projectFilter) || scopedProjects[0];
    }
    return scopedProjects[0];
  }, [scopedProjects, projectFilter]);
  const { data: visualData, isLoading: loadingVisual } = trpc.projects.getVisualControl.useQuery(
    currentProject ? { projectId: currentProject.id, weekOffset: weekWindowOffset, month: monthFilter } : undefined,
    { enabled: Boolean(currentProject) },
  );

  const activities = useMemo(() => ([...(visualData?.selectedActivities || [])] as ActivityRow[]).sort(comparePpsa), [visualData?.selectedActivities]);
  const periods = useMemo(() => (visualData?.selected?.periods || []) as PeriodRow[], [visualData?.selected?.periods]);
  const selectedPeriodIndex = Math.min(periodIndex, Math.max(0, periods.length - 1));
  const selectedPeriod = periods[selectedPeriodIndex];
  const monthOptions = useMemo(() => {
    const values = new Set<string>([currentMonthValue()]);
    activities.forEach((activity) => [activity.plannedStart, activity.plannedEnd].forEach((date) => {
      if (date && date !== "Sem data" && /^\d{4}-\d{2}/.test(date)) values.add(date.slice(0, 7));
    }));
    return Array.from(values).sort().reverse();
  }, [activities]);
  const modules = useMemo(() => Array.from(new Set(activities.map((activity) => activity.moduleName || "Sem módulo"))).sort(), [activities]);
  const consultants = useMemo(() => Array.from(new Set(activities.map((activity) => activity.resource || "Não informado"))).sort(), [activities]);
  const statuses = useMemo(() => ["concluido", "em_andamento", "atencao", "amarelo", "atrasado", "nao_iniciado"].filter((status, index, list) => (status === "atrasado" ? activities.some(isLateActivity) : activities.some((activity) => activity.status === status)) && list.indexOf(status) === index), [activities]);

  const matchesLocalFilters = (activity: ActivityRow) => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    if (localModule !== "todos" && (activity.moduleName || "Sem módulo") !== localModule) return false;
    if (localConsultant !== "todos" && (activity.resource || "Não informado") !== localConsultant) return false;
    if (localStatus !== "todos" && activity.status !== localStatus) return false;
    if (query && ![activity.ppsaCode, activity.description, activity.moduleName, activity.managementName, activity.resource].filter(Boolean).some((value) => String(value).toLocaleLowerCase("pt-BR").includes(query))) return false;
    return true;
  };

  const filteredActivities = useMemo(() => activities.filter(matchesLocalFilters), [activities, localModule, localConsultant, localStatus, search]);
  const summaryActivities = useMemo(() => {
    const operational = filteredActivities.filter((activity) => activity.level >= 3);
    return operational.length ? operational : filteredActivities;
  }, [filteredActivities]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, ActivityRow[]>();
    activities.forEach((activity) => {
      const parent = ppsaParent(activity.ppsaCode);
      if (!parent) return;
      map.set(parent, [...(map.get(parent) || []), activity]);
    });
    return map;
  }, [activities]);

  const visibleActivities = useMemo(() => filteredActivities.filter((activity) => {
    let parent = ppsaParent(activity.ppsaCode);
    while (parent) {
      if (collapsed.has(parent)) return false;
      const parentActivity = activities.find((candidate) => candidate.ppsaCode === parent);
      parent = parentActivity ? ppsaParent(parentActivity.ppsaCode) : null;
    }
    return true;
  }), [filteredActivities, collapsed, activities]);

  const periodActivities = useMemo(() => summaryActivities.filter((activity) => selectedPeriod ? activityOverlapsWeek(activity, selectedPeriod) : true), [summaryActivities, selectedPeriod]);
  const statusSummary = useMemo(() => statuses.map((status) => ({ status, count: periodActivities.filter((activity) => status === "atrasado" ? isLateActivity(activity) : activity.status === status).length })), [statuses, periodActivities]);
  const periodMetrics = periodActivities;
  const canonicalActivities = useMemo(() => activities.some((activity) => activity.level === 1) ? activities.filter((activity) => activity.level === 1) : activities, [activities]);
  const plannedInSchedule = useMemo(() => {
    return sumCanonicalPlannedHours(canonicalActivities.filter((activity) => activity.sourceCronogramId != null));
  }, [canonicalActivities]);

  const plannedOutsideSchedule = useMemo(() => {
    return sumCanonicalPlannedHours(canonicalActivities.filter((activity) => activity.sourceCronogramId == null));
  }, [canonicalActivities]);

  const totalPlannedHours = useMemo(() => {
    return plannedInSchedule + plannedOutsideSchedule;
  }, [plannedInSchedule, plannedOutsideSchedule]);

  const projectActualHours = useMemo(() => {
    return sumCanonicalActualHours(canonicalActivities);
  }, [canonicalActivities]);
  const periodPlannedHours = Number(selectedPeriod?.plannedHoursToDate || 0);
  const periodActualHours = Number(selectedPeriod?.actualHoursToDate || 0);
  const periodHoursBalance = periodPlannedHours - periodActualHours;
  const avgProgress = periodMetrics.length ? periodMetrics.reduce((sum, activity) => sum + Number(activity.progressPct || 0), 0) / periodMetrics.length : 0;
  const totalPresence = selectedPeriod ? selectedPeriod.onsite : 0;
  const totalRemote = selectedPeriod ? selectedPeriod.remote : 0;
  const nextDeliveries = useMemo(() => [...periodMetrics]
    .filter((activity) => activity.plannedEnd && activity.plannedEnd !== "Sem data")
    .sort((a, b) => a.plannedEnd.localeCompare(b.plannedEnd))
    .slice(0, 4), [periodMetrics]);

  useEffect(() => {
    setPeriodIndex(0);
    setWeekWindowOffset(0);
  }, [currentProject?.id, monthFilter]);

  const moduleSummary = useMemo(() => modules.map((module) => {
    const rows = periodMetrics.filter((activity) => (activity.moduleName || "Sem módulo") === module);
    return { module, activities: rows.length, planned: sumCanonicalPlannedHours(rows), actual: sumCanonicalActualHours(rows), progress: rows.length ? rows.reduce((sum, activity) => sum + Number(activity.progressPct || 0), 0) / rows.length : 0 };
  }), [modules, periodMetrics]);

  const toggleNode = (code: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const clearLocalFilters = () => {
    setLocalModule("todos");
    setLocalConsultant("todos");
    setLocalStatus("todos");
    setSearch("");
  };

  const previousWeekWindow = () => {
    if (periodIndex > 0) setPeriodIndex((index) => index - 1);
    else {
      setWeekWindowOffset((offset) => offset - 1);
      setPeriodIndex(4);
    }
  };

  const nextWeekWindow = () => {
    if (periodIndex < Math.max(0, periods.length - 1)) setPeriodIndex((index) => index + 1);
    else {
      setWeekWindowOffset((offset) => offset + 1);
      setPeriodIndex(0);
    }
  };

  const exportSchedule = () => {
    const headers = ["Código", "Atividade", "Módulo", "Responsável", "Início", "Término", "Horas Planejadas", "Horas Realizadas", "Avanço", "Status"];
    const rows = filteredActivities.map((activity) => [activity.ppsaCode, activity.description, activity.moduleName || "Sem módulo", activity.resource || "Não informado", dateBR(activity.plannedStart), dateBR(activity.plannedEnd), `${numberBR(activity.plannedHours, 2)} h`, `${numberBR(activity.actualHours, 2)} h`, `${numberBR(activity.progressPct)}%`, statusLabel(activity.status)]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cronograma-semanal-${currentProject?.code || "projeto"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loadingProjects || loadingVisual) return <div className="py-12 text-center text-sm text-slate-500">Carregando cronograma semanal...</div>;

  return (
    <div className="space-y-5">
      <GlobalFilterBar showProjectSelector />

      {!currentProject ? (
        <Card><CardContent className="py-16 text-center"><h2 className="text-lg font-bold text-slate-800">Nenhum projeto atende aos filtros globais</h2><p className="text-sm text-slate-500 mt-2">Ajuste os filtros globais e clique em Filtrar para carregar o cronograma.</p></CardContent></Card>
      ) : (
        <>
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1"><span className="text-blue-900 font-semibold">Cronograma semanal</span><span>•</span><span>{currentProject.client}</span><span>•</span><span>{currentProject.projectTypeDescription || currentProject.projectType || "Projeto"}</span></div>
              <h1 className="text-2xl font-bold tracking-tight text-blue-950">Cronograma Semanal - Projeto</h1>
              <p className="text-sm text-slate-500">Visão das atividades planejadas, evolução e entregas do projeto selecionado.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={String(currentProject.id)} onChange={(event) => setProjectFilter(event.target.value)} className="h-9 max-w-[320px] rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-blue-950">
                {scopedProjects.map((project) => <option key={project.id} value={String(project.id)}>#{project.code} - {project.name} ({project.client})</option>)}
              </select>
              <Badge className={`${currentProject.status === "verde" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : currentProject.status === "amarelo" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"} border`}><span className="mr-1.5 h-2 w-2 rounded-full bg-current inline-block" />{currentProject.status === "verde" ? "No prazo" : currentProject.status === "amarelo" ? "Em atenção" : "Em andamento"}</Badge>
              <Button size="sm" onClick={exportSchedule} className="h-9 bg-blue-900 text-xs hover:bg-blue-800"><Download className="mr-1.5 h-3.5 w-3.5" />Exportar</Button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card className="border-blue-200 bg-blue-50/30 shadow-xs"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Planejado no cronograma</div><div className="mt-1 text-2xl font-bold text-blue-950">{numberBR(plannedInSchedule, 1)} h</div><div className="mt-1 text-[10px] text-slate-500">PPSA Nível 1 com cronograma</div></CardContent></Card>
            <Card className="border-amber-200 bg-amber-50/40 shadow-xs"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Planejado fora do cronograma</div><div className="mt-1 text-2xl font-bold text-amber-900">{numberBR(plannedOutsideSchedule, 1)} h</div><div className="mt-1 text-[10px] text-slate-600">PPSA Nível 1 sem cronograma</div></CardContent></Card>
            <Card className="border-violet-200 bg-violet-50/30 shadow-xs"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Total planejado</div><div className="mt-1 text-2xl font-bold text-violet-950">{numberBR(totalPlannedHours, 1)} h</div><div className="mt-1 text-[10px] text-slate-500">Soma dos dois escopos</div><Badge variant="outline" className={`mt-2 text-[10px] ${periodHoursBalance >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo até a semana: {periodHoursBalance >= 0 ? "+" : "−"}{numberBR(Math.abs(periodHoursBalance), 1)} h</Badge></CardContent></Card>
            <Card className="border-emerald-200 bg-emerald-50/30 shadow-xs"><CardContent className="p-4"><div className="text-[11px] text-slate-500">Horas realizadas</div><div className="mt-1 text-2xl font-bold text-emerald-900">{numberBR(projectActualHours, 1)} h</div><div className="mt-1 text-[10px] text-slate-500">Nível 1 consolidado</div><div className="mt-1 text-[10px] text-emerald-700">Até a semana: {numberBR(periodActualHours, 1)} h</div></CardContent></Card>
            <Card className="border-slate-200/80 shadow-xs"><CardContent className="p-4"><div className="text-[11px] text-slate-500">% realizado x planejado</div><div className="mt-1 text-2xl font-bold text-blue-950">{numberBR(totalPlannedHours > 0 ? (projectActualHours / totalPlannedHours) * 100 : 0, 2)}%</div><div className="mt-1 text-[10px] text-slate-500">{numberBR(periodActivities.length)} atividades no período</div><div className="mt-1 text-[10px] text-slate-500">{numberBR(nextDeliveries.length)} próximas entregas</div></CardContent></Card>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="w-full lg:w-[74%] space-y-4">
              <Card className="border-slate-200/80 shadow-xs">
                <CardContent className="p-3">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
                    <Button size="sm" variant={activeTab === "cronograma" ? "default" : "outline"} onClick={() => setActiveTab("cronograma")} className={`h-8 text-xs ${activeTab === "cronograma" ? "bg-blue-900 hover:bg-blue-800" : ""}`}><Grid3X3 className="mr-1.5 h-3.5 w-3.5" />Cronograma Semanal</Button>
                    <Button size="sm" variant={activeTab === "modulos" ? "default" : "outline"} onClick={() => setActiveTab("modulos")} className={`h-8 text-xs ${activeTab === "modulos" ? "bg-blue-900 hover:bg-blue-800" : ""}`}><Layers className="mr-1.5 h-3.5 w-3.5" />Visão por Módulo</Button>
                    <Button size="sm" variant={activeTab === "atividades" ? "default" : "outline"} onClick={() => setActiveTab("atividades")} className={`h-8 text-xs ${activeTab === "atividades" ? "bg-blue-900 hover:bg-blue-800" : ""}`}><List className="mr-1.5 h-3.5 w-3.5" />Lista de Atividades</Button>
                    <Button size="sm" variant={activeTab === "ppsa" ? "default" : "outline"} onClick={() => setActiveTab("ppsa")} className={`h-8 text-xs ${activeTab === "ppsa" ? "bg-blue-900 hover:bg-blue-800" : ""}`}><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Estrutura Analítica (PPSA / Gantt)</Button>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-center gap-2 pt-3">
                    <div className="relative flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar atividade, código ou módulo..." className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs" /></div>
                    <select value={localModule} onChange={(event) => setLocalModule(event.target.value)} className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"><option value="todos">Todos os módulos</option>{modules.map((module) => <option key={module} value={module}>{module}</option>)}</select>
                    <select value={localConsultant} onChange={(event) => setLocalConsultant(event.target.value)} className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"><option value="todos">Todos os responsáveis</option>{consultants.map((consultant) => <option key={consultant} value={consultant}>{consultant}</option>)}</select>
                    <select value={localStatus} onChange={(event) => setLocalStatus(event.target.value)} className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"><option value="todos">Todos os status</option>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
                    <Button variant="ghost" size="sm" onClick={clearLocalFilters} className="h-8 text-xs text-slate-600">Limpar</Button>
                  </div>
                </CardContent>
              </Card>

              {activeTab === "cronograma" && (
                <Card className="overflow-hidden border-slate-200/80 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white p-3">
                    <div><CardTitle className="text-base font-bold text-blue-950">Cronograma Semanal - Projeto</CardTitle><p className="text-[11px] text-slate-500">{selectedPeriod ? formatPeriodLabel(selectedPeriod.range) : "Sem período disponível"} • {numberBR(visibleActivities.length)} itens visíveis</p></div>
                    <div className="flex flex-wrap items-center justify-end gap-1"><label className="mr-1 text-[11px] font-semibold text-slate-600" htmlFor="month-filter">Mês</label><select id="month-filter" aria-label="Filtrar por mês" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} className="h-8 max-w-[170px] rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold capitalize text-slate-700">{monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}</select><Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={previousWeekWindow} disabled={Boolean(monthFilter) && periodIndex === 0} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button><select aria-label="Filtrar por semana" value={selectedPeriod ? String(selectedPeriod.index) : ""} onChange={(event) => setPeriodIndex(Number(event.target.value))} className="h-8 max-w-[230px] rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">{periods.map((period) => <option key={period.index} value={String(period.index)}>Semana {period.weekNumber} • {formatPeriodLabel(period.range)}</option>)}</select><Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={nextWeekWindow} disabled={Boolean(monthFilter) && periodIndex >= Math.max(0, periods.length - 1)} aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></Button></div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1020px] border-collapse text-xs">
                      <thead><tr className="bg-blue-950 text-white text-[11px]"><th className="w-64 border-r border-blue-800 px-3 py-2 text-left">Código / Atividade</th><th className="w-36 border-r border-blue-800 px-2 py-2 text-left">Módulo</th>{periods.map((period) => <th key={period.index} title={`Semana ${period.weekNumber}: ${dateBR(period.startDate)} a ${dateBR(period.endDate)}`} aria-label={`Semana ${period.weekNumber}: início ${dateBR(period.startDate)}, término ${dateBR(period.endDate)}`} className={`min-w-28 border-r border-blue-800 px-2 py-2 text-center ${period.index === selectedPeriod?.index ? "bg-blue-800" : ""}`}><div className="cursor-help">Semana {period.weekNumber}</div><div className="text-[9px] font-normal text-blue-200">{formatPeriodLabel(period.range)}</div></th>)}<th className="w-24 px-2 py-2 text-center">Avanço</th><th className="w-32 px-2 py-2 text-center">Status</th></tr></thead>
                      <tbody>{visibleActivities.map((activity) => { const hasChildren = childrenByParent.has(activity.ppsaCode); const isCollapsed = collapsed.has(activity.ppsaCode); return <tr key={activity.id} className={`border-b border-white/70 ${levelRowClass(activity.level, activity.status)}`}><td className="px-3 py-2" style={{ paddingLeft: `${10 + Math.max(0, activity.level - 1) * 18}px` }}><div className="flex items-start gap-1.5"><button type="button" className="mt-0.5 h-4 w-4 text-slate-600" onClick={() => hasChildren && toggleNode(activity.ppsaCode)}>{hasChildren ? (isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : <span className="inline-block h-2 w-2 rounded-full bg-current opacity-50" />}</button>{hasChildren ? (isCollapsed ? <Folder className={`h-4 w-4 shrink-0 ${levelTextClass(activity.level)}`} /> : <FolderOpen className={`h-4 w-4 shrink-0 ${levelTextClass(activity.level)}`} />) : <FileText className={`h-4 w-4 shrink-0 ${levelTextClass(activity.level)}`} />}<div className="min-w-0"><div className={`font-mono text-[10px] font-bold ${levelTextClass(activity.level)}`}>{activity.ppsaCode}</div><div className={`font-semibold leading-tight ${levelTextClass(activity.level)}`}>{activity.description}</div></div></div></td><td className="px-2 py-2"><div className={`font-semibold ${levelTextClass(activity.level)}`}>{activity.moduleName || "Sem módulo"}</div><div className="text-[10px] text-slate-500">{activity.managementName || "Gestão Geral"}</div></td>{periods.map((period) => { const belongs = activityOverlapsWeek(activity, period); return <td key={period.index} className={`border-r border-slate-200/60 px-1 py-1.5 ${period.index === selectedPeriod?.index ? "bg-blue-50/50" : ""}`}>{belongs && <div className={`rounded-md border px-1.5 py-2 text-[10px] font-semibold ${activity.level === 1 ? "border-blue-300 bg-blue-500 text-white" : activity.level === 2 ? "border-violet-300 bg-violet-400 text-white" : "border-emerald-300 bg-emerald-500 text-white"}`} title={`${activity.description} • ${dateBR(activity.plannedStart)} a ${dateBR(activity.plannedEnd)}`}>{dateBR(activity.plannedStart)}<br />até {dateBR(activity.plannedEnd)}</div>}</td>; })}<td className="px-2 py-2"><div className="flex items-center gap-1"><Progress value={Number(activity.progressPct || 0)} className="h-1.5" /><span className="w-8 text-right text-[10px]">{numberBR(activity.progressPct)}%</span></div></td><td className="px-2 py-2 text-center"><Badge variant="outline" className={`gap-1 text-[10px] ${statusClass(activity.status)}`}><span className={`h-2 w-2 rounded-full ${statusDot(activity.status)}`} />{statusLabel(activity.status)}</Badge></td></tr>; })}</tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/70 p-3 text-[10px] text-slate-600"><span className="font-bold text-slate-800">Cores por nível:</span><span className="rounded border-l-4 border-blue-600 bg-sky-100 px-2 py-1 text-blue-950">Nível 1 — Macroestrutura</span><span className="rounded border-l-4 border-violet-600 bg-violet-100 px-2 py-1 text-violet-950">Nível 2 — Processo</span><span className="rounded border-l-4 border-emerald-500 bg-emerald-50 px-2 py-1 text-emerald-950">Nível 3 — Atividade</span></div>
                </Card>
              )}

              {activeTab === "modulos" && <Card className="border-slate-200/80 shadow-xs"><CardHeader><CardTitle className="text-base text-blue-950">Visão por Módulo</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2">{moduleSummary.map((item) => <div key={item.module} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between"><span className="font-bold text-slate-800">{item.module}</span><Badge variant="outline">{numberBR(item.activities)} atividades</Badge></div><div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><div><div className="text-slate-500">Planejadas</div><strong>{numberBR(item.planned, 1)} h</strong></div><div><div className="text-slate-500">Realizadas</div><strong>{numberBR(item.actual, 1)} h</strong></div><div><div className="text-slate-500">Avanço</div><strong className="text-emerald-700">{numberBR(item.progress)}%</strong></div></div><Progress value={item.progress} className="mt-3 h-1.5" /></div>)}</div></CardContent></Card>}

                  {activeTab === "atividades" && <Card className="overflow-hidden border-slate-200/80 shadow-xs"><CardHeader><CardTitle className="text-base text-blue-950">Lista de Atividades</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-xs"><thead className="bg-blue-950 text-white"><tr><th className="px-3 py-2 text-left">Código</th><th className="px-3 py-2 text-left">Atividade</th><th className="px-3 py-2 text-left">Módulo</th><th className="px-3 py-2 text-left">Responsável</th><th className="px-3 py-2 text-center">Início</th><th className="px-3 py-2 text-center">Término</th><th className="px-3 py-2 text-center">Horas (P/R)</th><th className="px-3 py-2 text-center">Avanço</th><th className="px-3 py-2 text-center">Status</th></tr></thead><tbody>{filteredActivities.map((activity) => <tr key={activity.id} className={`border-b ${levelRowClass(activity.level, activity.status)}`}><td className="px-3 py-2 font-mono font-bold">{activity.ppsaCode}</td><td className="px-3 py-2 font-semibold">{activity.description}</td><td className="px-3 py-2">{activity.moduleName || "Sem módulo"}</td><td className="px-3 py-2">{activity.resource || "Não informado"}</td><td className="px-3 py-2 text-center">{dateBR(activity.plannedStart)}</td><td className="px-3 py-2 text-center">{dateBR(activity.plannedEnd)}</td><td className="px-3 py-2 text-center whitespace-nowrap">{numberBR(activity.plannedHours, 1)} h / {numberBR(activity.actualHours, 1)} h</td><td className="px-3 py-2"><div className="flex items-center gap-1"><Progress value={Number(activity.progressPct || 0)} className="h-1.5" /><span className="text-[10px]">{numberBR(activity.progressPct)}%</span></div></td><td className="px-3 py-2 text-center"><Badge variant="outline" className={`text-[10px] ${statusClass(activity.status)}`}>{statusLabel(activity.status)}</Badge></td></tr>)}</tbody></table></div></CardContent></Card>}

                  {activeTab === "ppsa" && (
                    <Card className="overflow-hidden border-slate-200/80 shadow-xs">
                      <CardHeader className="p-4 pb-2 border-b border-slate-100">
                        <CardTitle className="text-base text-blue-950">Estrutura Analítica do Cronograma (PPSA) e Visão Temporal Gantt</CardTitle>
                        <p className="text-xs text-slate-500">Acompanhamento das atividades com datas, horas planejadas x realizadas e barras temporais por semana.</p>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1100px] text-xs">
                            <thead className="bg-blue-950 text-white text-[11px]">
                              <tr>
                                <th className="px-3 py-2 text-left w-64">Estrutura / Atividade</th>
                                <th className="px-2 py-2 text-center w-20">Nível</th>
                                <th className="px-2 py-2 text-left w-40">Gestão e Módulo</th>
                                <th className="px-2 py-2 text-left w-32">Responsável</th>
                                <th className="px-2 py-2 text-center w-24">Início</th>
                                <th className="px-2 py-2 text-center w-24">Término</th>
                                <th className="px-2 py-2 text-center w-24">Horas Plan.</th>
                                <th className="px-2 py-2 text-center w-24">Horas Real.</th>
                                <th className="px-2 py-2 text-center w-24">Avanço</th>
                                <th className="px-2 py-2 text-center w-28">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredActivities.map((activity) => (
                                <tr key={activity.id} className={`border-b ${levelRowClass(activity.level, activity.status)}`}>
                                  <td className="px-3 py-2" style={{ paddingLeft: `${10 + Math.max(0, activity.level - 1) * 16}px` }}>
                                    <div className="font-mono text-[10px] font-bold text-slate-700">{activity.ppsaCode}</div>
                                    <div className="font-semibold text-slate-900">{activity.description}</div>
                                  </td>
                                  <td className="px-2 py-2 text-center">
                                    <Badge variant="outline" className={`text-[10px] ${activity.level === 1 ? "border-blue-300 bg-blue-50 text-blue-900" : activity.level === 2 ? "border-violet-300 bg-violet-50 text-violet-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>N{activity.level}</Badge>
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="font-semibold text-slate-800">{activity.moduleName || "Sem módulo"}</div>
                                    <div className="text-[10px] text-slate-500">{activity.managementName || "Gestão Geral"}</div>
                                  </td>
                                  <td className="px-2 py-2 text-slate-600">{activity.resource || "Não informado"}</td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap">{dateBR(activity.plannedStart)}</td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap">{dateBR(activity.plannedEnd)}</td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap font-semibold">{numberBR(activity.plannedHours, 1)} h</td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap font-bold text-blue-900">{numberBR(activity.actualHours, 1)} h</td>
                                  <td className="px-2 py-2 text-center">
                                    <div className="flex items-center gap-1">
                                      <Progress value={Number(activity.progressPct || 0)} className="h-1.5" />
                                      <span className="text-[10px] font-semibold">{numberBR(activity.progressPct)}%</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap">
                                    <Badge variant="outline" className={`text-[10px] ${statusClass(activity.status)}`}>{statusLabel(activity.status)}</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
            </div>

            <aside className="w-full lg:w-[26%] space-y-4">
              <Card className="border-slate-200/80 shadow-xs"><CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm text-blue-950"><BarChart3 className="h-4 w-4 text-blue-700" />Avanço físico semanal do projeto</CardTitle><p className="text-[10px] text-slate-500">Calculado por horas, informado no Check-in e programado até o período.</p></CardHeader><CardContent className="h-64 p-2"><ResponsiveContainer width="100%" height="100%"><LineChart data={periods.map((period) => ({ name: `S${period.weekNumber}`, calculado: period.calculatedProgress, informado: period.informedProgress, programado: period.programmedProgress }))} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value, name) => [`${numberBR(value, 1)}%`, name === "calculado" ? "Calculado por horas" : name === "informado" ? "Informado no Check-in" : "Programado"]} /><Legend formatter={(value: string) => value === "calculado" ? "Calculado por horas" : value === "informado" ? "Informado no Check-in" : "Programado"} /><Line type="monotone" dataKey="programado" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls /><Line type="monotone" dataKey="calculado" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} /><Line type="monotone" dataKey="informado" stroke="#16a34a" strokeWidth={3} dot={{ r: 3 }} connectNulls /></LineChart></ResponsiveContainer></CardContent></Card>
              <SCurveSection projectId={currentProject.id} projectName={currentProject.name} defaultModule={localModule !== "todos" ? localModule : "todos"} />
              <Card className="border-slate-200/80 shadow-xs"><CardHeader className="p-4 pb-2"><CardTitle className="text-sm text-blue-950">Status das atividades</CardTitle><p className="text-[11px] text-slate-500">Período selecionado: {selectedPeriod ? formatPeriodLabel(selectedPeriod.range) : "semana não informada"}</p></CardHeader><CardContent className="p-4"><div className="relative h-44 w-full">{statusSummary.some((item) => item.count > 0) ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusSummary.filter((item) => item.count > 0).map((item) => ({ name: statusLabel(item.status), value: item.count }))} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={3}>{statusSummary.filter((item) => item.count > 0).map((item, index) => <Cell key={item.status} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value: any) => [`${value} atividades`, "Quantidade"]} contentStyle={{ fontSize: "11px", borderRadius: "6px" }} /></PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-slate-400">Nenhuma atividade no período</div>}</div><div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-[10px] text-slate-700">{statusSummary.map((item, index) => <span key={item.status} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />{statusLabel(item.status)} <strong>{item.count}</strong></span>)}</div></CardContent></Card>
              <Card className="border-slate-200/80 shadow-xs"><CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm text-blue-950"><Calendar className="h-4 w-4 text-blue-700" />Próximas entregas</CardTitle></CardHeader><CardContent className="space-y-2 p-4 pt-1">{nextDeliveries.length === 0 ? <p className="text-xs text-slate-500">Nenhuma data de término cadastrada.</p> : nextDeliveries.map((activity) => <div key={activity.id} className="flex gap-2 border-b border-slate-100 pb-2 last:border-0"><div className="min-w-16 text-[11px] font-bold text-blue-900">{dateBR(activity.plannedEnd)}</div><div className="min-w-0"><div className="truncate text-[11px] font-semibold text-slate-800">{activity.description}</div><div className="text-[10px] text-slate-500">{activity.ppsaCode} • {activity.moduleName || "Sem módulo"}</div></div></div>)}</CardContent></Card>
              <Card className="border-slate-200/80 shadow-xs"><CardContent className="p-4 text-xs text-slate-600"><div className="flex items-center gap-2 font-semibold text-slate-800"><MapPin className="h-4 w-4 text-emerald-600" />Distribuição da semana</div><div className="mt-3 flex items-center justify-between"><span>Presencial</span><strong className="text-emerald-700">{numberBR(totalPresence)}</strong></div><div className="mt-1 flex items-center justify-between"><span>Remoto</span><strong className="text-blue-700">{numberBR(totalRemote)}</strong></div><p className="mt-3 text-[10px] text-slate-400">Dados calculados para o projeto e período selecionados.</p></CardContent></Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
