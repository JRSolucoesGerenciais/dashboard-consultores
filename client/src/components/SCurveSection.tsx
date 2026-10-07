import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Camera, CheckCircle2, History, Layers, RefreshCw, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type SCurvePoint = {
  date: string;
  label: string;
  plannedHours: number;
  actualHours: number;
  plannedPct: number;
  actualPct: number;
  baselinePlannedHours?: number | null;
  baselineActualHours?: number | null;
};

interface SCurveSectionProps {
  projectId: number;
  projectName?: string;
  defaultModule?: string;
  className?: string;
}

function numberBR(value: unknown, decimals = 1) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function SCurveSection({ projectId, projectName, defaultModule = "todos", className = "" }: SCurveSectionProps) {
  const [selectedModule, setSelectedModule] = useState(defaultModule);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | undefined>(undefined);
  const [snapshotMonth, setSnapshotMonth] = useState(currentMonthValue);
  const [isBaselineChoice, setIsBaselineChoice] = useState(false);

  const utils = trpc.useUtils();
  const { data: curveData, isLoading } = trpc.projects.getSCurve.useQuery(
    {
      projectId,
      moduleName: selectedModule,
      compareSnapshotId: selectedSnapshotId,
    },
    { enabled: projectId > 0 }
  );

  const saveMutation = trpc.projects.saveSCurveSnapshot.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.isBaseline
          ? `Linha de Base salva com sucesso: ${result.snapshotName}`
          : `Snapshot mensal salvo com sucesso: ${result.snapshotName}`
      );
      utils.projects.getSCurve.invalidate({ projectId });
    },
    onError: (error) => {
      toast.error(`Falha ao salvar snapshot: ${error.message}`);
    },
  });

  const points = (curveData?.points || []) as SCurvePoint[];
  const modules = curveData?.modules || [];
  const snapshots = curveData?.snapshots || [];
  const comparison = curveData?.comparison;

  const handleSaveSnapshot = () => {
    saveMutation.mutate({
      projectId,
      snapshotMonth,
      moduleName: selectedModule,
      isBaseline: isBaselineChoice,
    });
  };

  return (
    <Card className={`border-indigo-200 bg-indigo-50/20 shadow-xs ${className}`}>
      <CardHeader className="p-4 pb-2 border-b border-indigo-100/70">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-bold text-indigo-950 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-700" />
              Curva S de Esforço Acumulado
            </CardTitle>
            <CardDescription className="text-xs text-slate-600">
              Evolução das horas acumuladas planejadas versus realizadas ao longo do projeto, consolidada no Nível 1.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Filtro por Módulo */}
            <div className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-md px-2 py-1 shadow-2xs">
              <Layers className="h-3.5 w-3.5 text-indigo-700" />
              <label htmlFor="scurve-module-select" className="text-[11px] font-semibold text-indigo-950">Módulo:</label>
              <select
                id="scurve-module-select"
                aria-label="Filtrar Curva S por módulo"
                value={selectedModule}
                onChange={(e) => {
                  setSelectedModule(e.target.value);
                  setSelectedSnapshotId(undefined);
                }}
                className="bg-transparent text-xs font-semibold text-slate-800 outline-none pr-1"
              >
                <option value="todos">Todos os módulos</option>
                {modules.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Comparar com Snapshot / Linha de Base */}
            <div className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-md px-2 py-1 shadow-2xs">
              <History className="h-3.5 w-3.5 text-indigo-700" />
              <label htmlFor="scurve-snapshot-select" className="text-[11px] font-semibold text-indigo-950">Comparar:</label>
              <select
                id="scurve-snapshot-select"
                aria-label="Comparar com snapshot ou linha de base"
                value={selectedSnapshotId ? String(selectedSnapshotId) : ""}
                onChange={(e) => setSelectedSnapshotId(e.target.value ? Number(e.target.value) : undefined)}
                className="bg-transparent text-xs text-slate-800 outline-none max-w-[210px] truncate"
              >
                <option value="">
                  {snapshots.length === 0 ? "Nenhum snapshot salvo" : "Linha de Base Padrão"}
                </option>
                {snapshots.map((snap) => (
                  <option key={snap.id} value={String(snap.id)}>
                    {snap.isBaseline ? "★ " : ""}{snap.snapshotName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Barra de Ação de Snapshot */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-indigo-300 bg-white text-indigo-900 font-semibold">
              Planejado: {numberBR(curveData?.totalPlannedHours, 1)} h
            </Badge>
            <Badge variant="outline" className="border-blue-300 bg-white text-blue-900 font-semibold">
              Realizado: {numberBR(curveData?.totalActualHours, 1)} h
            </Badge>
            {comparison && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-900 border-amber-300 font-semibold">
                Comparando: {comparison.isBaseline ? "Linha de Base" : "Snapshot"} ({comparison.snapshotMonth}) • {numberBR(comparison.totalPlannedHours, 1)} h plan.
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="month"
              aria-label="Mês do snapshot"
              value={snapshotMonth}
              onChange={(e) => setSnapshotMonth(e.target.value)}
              className="h-7 text-[11px] px-1.5 border border-indigo-200 rounded bg-white text-slate-700"
            />
            <label className="flex items-center gap-1 cursor-pointer select-none text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={isBaselineChoice}
                onChange={(e) => setIsBaselineChoice(e.target.checked)}
                className="h-3 w-3 rounded text-indigo-700"
              />
              Linha de base
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveSnapshot}
              disabled={saveMutation.isPending || !projectId}
              className="h-7 text-xs bg-white border-indigo-300 hover:bg-indigo-50 text-indigo-950 gap-1 px-2.5"
            >
              {saveMutation.isPending ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Camera className="h-3 w-3 text-indigo-700" />
              )}
              Salvar Snapshot
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="h-72 p-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            Calculando Curva S do projeto...
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            Sem dados de atividades no Nível 1 para o escopo selecionado.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => `${numberBR(value, 0)}h`} />
              <Tooltip
                formatter={(value: any, name: any) => [
                  `${numberBR(value, 1)} h`,
                  name === "plannedHours"
                    ? "Planejado Atual"
                    : name === "actualHours"
                    ? "Realizado Atual"
                    : name === "baselinePlannedHours"
                    ? `Planejado (${comparison?.isBaseline ? "Linha de Base" : "Snapshot"})`
                    : `Realizado (${comparison?.isBaseline ? "Linha de Base" : "Snapshot"})`,
                ]}
              />
              <Legend
                formatter={(value: string) =>
                  value === "plannedHours"
                    ? "Planejado Atual"
                    : value === "actualHours"
                    ? "Realizado Atual"
                    : value === "baselinePlannedHours"
                    ? `Planejado (${comparison?.isBaseline ? "Linha de Base" : "Snapshot"})`
                    : `Realizado (${comparison?.isBaseline ? "Linha de Base" : "Snapshot"})`
                }
              />
              {/* Linhas da Curva Atual */}
              <Line
                type="monotone"
                dataKey="plannedHours"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="actualHours"
                stroke="#2563eb"
                strokeWidth={3}
                dot={false}
              />
              {/* Linhas de Comparação (Snapshot / Linha de Base) */}
              {comparison && (
                <Line
                  type="monotone"
                  dataKey="baselinePlannedHours"
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  dot={false}
                />
              )}
              {comparison && (
                <Line
                  type="monotone"
                  dataKey="baselineActualHours"
                  stroke="#64748b"
                  strokeDasharray="2 2"
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
