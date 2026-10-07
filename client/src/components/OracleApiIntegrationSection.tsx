import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Zap,
  CheckCircle2,
  Clock,
  RotateCcw,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Send,
  Database,
  FileJson,
} from "lucide-react";

type OraclePreview = {
  rowsCount: number;
  projectsCount: number;
  namedProjectsCount: number;
  levelCounts: Array<{ level: string; count: number }>;
  statusCounts: Array<{ status: string; count: number }>;
  activeProjectsCount: number;
  closedProjectsCount: number;
  plannedHoursLevel1: number;
  actualHoursLevel1: number;
  plannedHoursInScheduleLevel1: number;
  plannedHoursOutsideScheduleLevel1: number;
  actualHoursInScheduleLevel1: number;
  actualHoursOutsideScheduleLevel1: number;
  officialProductiveActualHours: number;
  officialUnproductiveActualHours: number;
  officialPlannedHours: number;
  officialPlannedHoursInSchedule: number;
  officialPlannedHoursOutsideSchedule: number;
  isFinalSqlRevAtual: boolean;
  isFinalSqlRev06: boolean;
  isFinalSqlRev03: boolean;
  isFinalSqlRev02: boolean;
  isImportable: boolean;
  validationWarnings: string[];
  projectCoveragePct: number;
  missingProjectCount: number;
  referenceProject122?: {
    plannedHours: number;
    plannedHoursInSchedule: number;
    plannedHoursOutsideSchedule: number;
    actualHours: number;
  };
  stagingSessionId?: string;
  detectedColumns: string[];
  comparison?: {
    newProjectsCount: number;
    updatedProjectsCount: number;
    newProjects: Array<{ code: string; name: string; client: string }>;
    updatedProjects: Array<{ code: string; name: string; client: string }>;
  };
  sampleRows: Array<{
    projectCode: string;
    projectName: string;
    client: string;
    ppsaCode: string;
    description: string;
    level: number;
    status: string;
    plannedHours: number;
    actualHours: number;
  }>;
};

export function OracleApiIntegrationSection() {
  const utils = trpc.useUtils();

  // 1. Dados de Configuração
  const { data: config, isLoading: loadingConfig } =
    trpc.projects.getOracleConfig.useQuery();

  const [endpointUrl, setEndpointUrl] = useState(
    "https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2"
  );
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(180);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);

  // 2. Estado de Teste e Prévia Analisada
  const [hasTestedPreview, setHasTestedPreview] = useState(false);
  const [activeImportRunId, setActiveImportRunId] = useState<number | null>(null);
  const [importProgressPct, setImportProgressPct] = useState<number>(0);
  const [importStatusMessage, setImportStatusMessage] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const handledTerminalRunRef = useRef<number | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{
    fileIdentifier: string;
    rowsCount: number;
    preview: OraclePreview;
  } | null>(null);

  // 3. Paginação do Histórico
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const { data: runsData, isLoading: loadingRuns } =
    trpc.projects.listOracleSyncRuns.useQuery({ page, pageSize });

  // Sincroniza estado inicial com a resposta do backend
  useEffect(() => {
    if (config) {
      if (config.endpointUrl) setEndpointUrl(config.endpointUrl);
      if (config.syncIntervalMinutes)
        setSyncIntervalMinutes(config.syncIntervalMinutes);
      setBackgroundEnabled(Boolean(config.backgroundEnabled));
    }
  }, [config]);

  useEffect(() => {
    const pendingRun = runsData?.items.find(
      (run) => run.status === "processando" && Boolean(run.stagingSessionId),
    );
    if (pendingRun && !activeImportRunId && !isImporting) {
      setActiveImportRunId(pendingRun.id);
      setIsImporting(true);
      setImportProgressPct(pendingRun.progressPct || 15);
      setImportStatusMessage(pendingRun.message || "Retomando a importação persistida...");
    }

    // Se o polling do status perdeu uma resposta, o histórico continua sendo
    // uma fonte confiável do estado terminal. Não deixe o botão preso em
    // "Importando" depois que a execução já foi publicada ou falhou.
    const observedRun = activeImportRunId
      ? runsData?.items.find((run) => run.id === activeImportRunId)
      : undefined;
    if (isImporting && observedRun && observedRun.status !== "processando") {
      const terminalRun = observedRun.status === "publicada_ativa" || observedRun.status === "erro";
      if (terminalRun) {
        handledTerminalRunRef.current = observedRun.id;
        setImportProgressPct(observedRun.progressPct || (observedRun.status === "publicada_ativa" ? 100 : 0));
        setImportStatusMessage(observedRun.message || observedRun.errorMessage || "Execução encerrada.");
        setIsImporting(false);
        setActiveImportRunId(null);
        setHasTestedPreview(false);
        setPreviewInfo(null);
      }
    }
  }, [runsData, activeImportRunId, isImporting]);

  // Mutations
  const saveConfigMutation = trpc.projects.saveOracleConfig.useMutation({
    onSuccess: () => {
      toast.success("Endpoint e configurações de sync salvas com sucesso!");
      utils.projects.getOracleConfig.invalidate();
    },
    onError: (err) => {
      toast.error(`Erro ao salvar endpoint: ${err.message}`);
    },
  });

  const testConnectionMutation = trpc.projects.testOracleConnection.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        const official = Boolean(res.preview?.isImportable);
        if (official) toast.success(res.message);
        else toast.error(res.message);
        setHasTestedPreview(official);
        setPreviewInfo({
          fileIdentifier: res.previewJsonFileName,
          rowsCount: res.previewRowsCount,
          preview: res.preview as OraclePreview,
        });
      } else {
        toast.error(res.message);
      }
      utils.projects.getOracleConfig.invalidate();
    },
    onError: (err) => {
      toast.error(`Falha no teste: ${err.message}`);
    },
  });

  const publishPreviewMutation = trpc.projects.publishOraclePreview.useMutation({
    onSuccess: (res) => {
      if (!res.success || res.status === "erro") {
        setIsImporting(false);
        setActiveImportRunId(null);
        toast.error(`Falha no processamento: ${res.message}`);
        utils.projects.listOracleSyncRuns.invalidate();
        utils.projects.getOracleConfig.invalidate();
        return;
      }

      if (res.status === "publicada_ativa") {
        setIsImporting(false);
        setActiveImportRunId(null);
        setImportProgressPct(100);
        setImportStatusMessage(res.message);
        setHasTestedPreview(false);
        setPreviewInfo(null);
        toast.success("Importação concluída com sucesso! Os projetos foram atualizados.");
        utils.projects.listOracleSyncRuns.invalidate();
        utils.projects.getOracleConfig.invalidate();
        utils.projects.list.invalidate();
        utils.projects.getPortfolioMetrics.invalidate();
        return;
      }

      toast.info("Importação iniciada em segundo plano. Acompanhando progresso...");
      setActiveImportRunId(res.runId);
      setIsImporting(true);
      setImportProgressPct(20);
      setImportStatusMessage("Processando dados e salvando cronogramas...");
      utils.projects.listOracleSyncRuns.invalidate();
      utils.projects.getOracleConfig.invalidate();
    },
    onError: async (err) => {
      const latest = await utils.projects.listOracleSyncRuns
        .fetch({ page: 1, pageSize: 1 })
        .then((history) => history.items[0])
        .catch(() => undefined);
      if (latest?.status === "processando" && latest.stagingSessionId) {
        setActiveImportRunId(latest.id);
        setIsImporting(true);
        setImportProgressPct(latest.progressPct || 15);
        setImportStatusMessage("A conexão foi interrompida pelo gateway, mas a importação ficou salva e continuará automaticamente.");
        toast.info("A importação foi salva; acompanhando a gravação dos lotes...");
        return;
      }
      setIsImporting(false);
      toast.error(`Não foi possível iniciar a importação: ${err.message.includes("Service Unavailable") ? "o servidor ficou indisponível. Teste a conexão novamente." : err.message}`);
    },
  });

  // Polling para acompanhar a importação assíncrona até 100% sem estourar timeout do proxy
  const { data: runStatus } = trpc.projects.getOracleSyncRunStatus.useQuery(
    { runId: activeImportRunId! },
    {
      enabled: Boolean(activeImportRunId && isImporting),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "publicada_ativa" || status === "erro") return false;
        return 2000;
      },
    }
  );

  useEffect(() => {
    if (!runStatus) return;
    const isTerminal = runStatus.status === "publicada_ativa" || runStatus.status === "erro";
    if (isTerminal && handledTerminalRunRef.current === runStatus.id) return;
    setImportProgressPct(runStatus.progressPct || 0);
    if (runStatus.message) setImportStatusMessage(runStatus.message);

    if (runStatus.status === "publicada_ativa") {
      handledTerminalRunRef.current = runStatus.id;
      setIsImporting(false);
      setActiveImportRunId(null);
      setHasTestedPreview(false);
      setPreviewInfo(null);
      toast.success("Importação concluída com sucesso! Os projetos foram atualizados.");
      utils.projects.listOracleSyncRuns.invalidate();
      utils.projects.getOracleConfig.invalidate();
      utils.projects.list.invalidate();
      utils.projects.getPortfolioMetrics.invalidate();
    } else if (runStatus.status === "erro") {
      handledTerminalRunRef.current = runStatus.id;
      setIsImporting(false);
      setActiveImportRunId(null);
      toast.error(`Falha no processamento: ${runStatus.errorMessage || runStatus.message}`);
      utils.projects.listOracleSyncRuns.invalidate();
    }
  }, [runStatus]);

  const rollbackMutation = trpc.projects.rollbackOracleSyncRun.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      utils.projects.listOracleSyncRuns.invalidate();
      utils.projects.getOracleConfig.invalidate();
    },
    onError: (err) => {
      toast.error(`Erro ao executar rollback: ${err.message}`);
    },
  });

  const handleSaveEndpoint = () => {
    saveConfigMutation.mutate({
      endpointUrl,
      syncIntervalMinutes: Number(syncIntervalMinutes) || 180,
      backgroundEnabled,
    });
  };

  const handleTestConnection = () => {
    testConnectionMutation.mutate({ endpointUrl });
  };

  const handlePublishPreview = () => {
    setIsImporting(true);
    setImportProgressPct(15);
    setImportStatusMessage("Servidor processando a importação; aguarde a confirmação da gravação...");
    publishPreviewMutation.mutate({
      fileIdentifier: previewInfo?.fileIdentifier,
      rowsCount: previewInfo?.rowsCount,
      projectCount: previewInfo?.preview.projectsCount,
      stagingSessionId: previewInfo?.preview.stagingSessionId,
      endpointUrl,
    });
  };

  const formatDateHour = (dateInput: unknown) => {
    if (!dateInput) return "16/09/2026, 12:00:49";
    const d = new Date(dateInput as any);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
  };

  const totalPages = runsData?.totalPages ?? 1;
  const totalItems = runsData?.total ?? 0;
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems);
  const previewHasRevAtual = Boolean(previewInfo?.preview.isFinalSqlRevAtual);
  const previewHasRev06 = Boolean(previewInfo?.preview.isFinalSqlRev06);
  const previewHasRev03 = Boolean(previewInfo?.preview.isFinalSqlRev03);
  const previewCanImport = Boolean(previewInfo?.preview.isImportable);
  const previewIsRevAtual = Boolean(previewHasRevAtual);
  const previewIsViewRev06 = Boolean(previewHasRev06);
  const previewIsOfficial = Boolean(previewInfo?.preview.isFinalSqlRev03 && previewCanImport);
  const previewIsLegacyImportable = Boolean(previewInfo?.preview.isFinalSqlRev02 && previewCanImport);

  return (
    <div className="space-y-6">
      {/* 1. Card Superior: Conexão com API Intermediária CSAgenda */}
      <Card className="rounded-xl border border-amber-200/80 bg-white shadow-xs">
        <CardContent className="p-6 space-y-5">
          {/* Topo: Título + Botão de importação após revisão */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500 fill-amber-500" />
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  Conexão com API Intermediária CSAgenda
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
                Consulte o endpoint CSAgenda, revise a prévia real dos dados e importe somente depois de validar o retorno. O teste de conexão não grava projetos.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePublishPreview}
              disabled={!hasTestedPreview || !previewCanImport || isImporting || publishPreviewMutation.isPending}
              className={`text-xs h-8 px-3.5 border font-medium transition-all ${
                hasTestedPreview && !isImporting
                  ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 shadow-2xs"
                  : "border-amber-200/80 bg-amber-50/40 text-amber-800/60 cursor-not-allowed"
              }`}
            >
              {isImporting || publishPreviewMutation.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Importando ({importProgressPct}%)...
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5 mr-1.5 text-amber-600" />
              {previewInfo && !previewCanImport ? "Importação bloqueada — revisar retorno" : "Importar dados da prévia"}
                </>
              )}
            </Button>
          </div>

          {/* Barra de Progresso quando estiver importando */}
          {isImporting && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-amber-900">
                <span>{importStatusMessage || `Processando importação em segundo plano (${importProgressPct}%)...`}</span>
                <span>{importProgressPct}%</span>
              </div>
              <div className="w-full bg-amber-200/70 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-600 h-2 transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(5, importProgressPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Linha de Inputs: Endpoint e Intervalo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-1">
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                Endpoint API REST CSAgenda
              </label>
              <Input
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder="https://www.cscompusoftware.com.br/..."
                className="h-10 text-xs font-mono text-slate-800 bg-white border-slate-200 focus-visible:ring-amber-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                O token não fica no navegador: será lido pelo servidor na variável <span className="font-mono text-slate-600">ORACLE_API_TOKEN</span>.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block whitespace-nowrap">
                Intervalo de Sync (minutos)
              </label>
              <Input
                type="number"
                value={syncIntervalMinutes}
                onChange={(e) => setSyncIntervalMinutes(Number(e.target.value))}
                min={15}
                max={1440}
                className="h-10 text-xs text-slate-800 bg-white border-slate-200"
              />
            </div>
          </div>

          {/* Toggle de Sincronização Periódica */}
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3.5 flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-800 block">
                Ativar Sincronização Periódica em Segundo Plano
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Quando ativado, a plataforma executa a consulta da API CSAgenda no intervalo configurado acima. A importação automática deve ser habilitada somente após validar o contrato e a regra de atualização.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={backgroundEnabled}
              aria-label="Ativar sincronização periódica em segundo plano"
              onClick={() => setBackgroundEnabled((current) => !current)}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 ${
                backgroundEnabled ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-slate-200"
              }`}
            >
              <span
                aria-hidden="true"
                className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  backgroundEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Rodapé do Bloco de Conexão */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>
                Última tentativa de sincronização:{" "}
                <strong className="text-slate-700">
                  {formatDateHour(config?.lastAttemptAt || new Date())}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testConnectionMutation.isPending}
                className="h-9 px-3.5 text-xs font-medium border-emerald-400 text-emerald-900 bg-emerald-50/50 hover:bg-emerald-100/70 gap-1.5"
              >
                {testConnectionMutation.isPending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                )}
                {testConnectionMutation.isPending ? "Consultando API e analisando o retorno..." : "Testar conexão + analisar retorno"}
              </Button>

              <Button
                size="sm"
                onClick={handleSaveEndpoint}
                disabled={saveConfigMutation.isPending}
                className="h-9 px-4 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-xs"
              >
                {saveConfigMutation.isPending ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar endpoint"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {previewInfo?.preview && (
        <Card className="rounded-xl border border-blue-200 bg-blue-50/30 shadow-xs overflow-hidden">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-blue-700" />
                  <h3 className="text-sm font-bold text-slate-900">Prévia real dos dados da API</h3>
                  <Badge className={previewCanImport ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-amber-100 text-amber-900 border border-amber-300"}>
                    {previewIsRevAtual ? `HTTP 200 • SQL RevAtual ${previewCanImport ? "validada" : "bloqueada"}` : previewIsViewRev06 ? `HTTP 200 • View REV06 ${previewCanImport ? "validada" : "bloqueada"}` : previewIsOfficial ? "HTTP 200 • Rev03 validada" : previewIsLegacyImportable ? "HTTP 200 • Analisada" : "HTTP 200 • Retorno recebido"}
                  </Badge>
                  <Badge className={previewCanImport ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-rose-100 text-rose-800 border border-rose-300"}>
                    {previewIsRevAtual ? `SQL RevAtual • ${previewCanImport ? "Importável" : "Bloqueada"}` : previewIsViewRev06 ? `SQL View REV06 • ${previewCanImport ? "Importável" : "Bloqueada"}` : previewIsOfficial ? "SQL Rev03 • Importável" : previewIsLegacyImportable ? "SQL anterior • Importável" : previewHasRev03 ? "SQL Rev03 • Bloqueada" : "Contrato não reconhecido"}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Esta leitura ainda não gravou os projetos. Revise os números e a amostra antes de importar.
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <div className="font-mono font-semibold text-slate-700">{previewInfo.fileIdentifier}</div>
                <div>{previewInfo.preview.detectedColumns.length} colunas detectadas</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-9">
              {[
                ["Registros", previewInfo.preview.rowsCount.toLocaleString("pt-BR")],
                ["Projetos", previewInfo.preview.projectsCount.toLocaleString("pt-BR")],
                ["Projetos nomeados", previewInfo.preview.namedProjectsCount.toLocaleString("pt-BR")],
                ["Ativos", previewInfo.preview.activeProjectsCount.toLocaleString("pt-BR")],
                ["Encerrados", previewInfo.preview.closedProjectsCount.toLocaleString("pt-BR")],
                [previewIsOfficial ? "Plan. no cronograma" : previewIsRevAtual ? "Plan. no cronograma" : previewIsViewRev06 ? "Plan. no cronograma — REV06 N1" : previewIsLegacyImportable ? "Plan. no cronograma — PPSA" : "Diagnóstico — cronograma", (previewIsOfficial ? previewInfo.preview.officialPlannedHoursInSchedule : previewIsRevAtual || previewIsViewRev06 || previewIsLegacyImportable ? previewInfo.preview.plannedHoursInScheduleLevel1 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 }) + " h"],
                [previewIsOfficial ? "Plan. fora do cronograma" : previewIsRevAtual ? "Plan. fora do escopo" : previewIsViewRev06 ? "Plan. fora — REV06 N1" : previewIsLegacyImportable ? "Plan. fora — PPSA" : "Diagnóstico — fora", (previewIsOfficial ? previewInfo.preview.officialPlannedHoursOutsideSchedule : previewIsRevAtual || previewIsViewRev06 || previewIsLegacyImportable ? previewInfo.preview.plannedHoursOutsideScheduleLevel1 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 }) + " h"],
                [previewIsOfficial ? "Total planejado por módulo" : previewIsRevAtual ? "Total planejado — SQL RevAtual" : previewIsViewRev06 ? "Total planejado pela View — PPSA N1" : previewIsLegacyImportable ? "Total planejado PPSA Nível 1" : "Total planejado", (previewIsOfficial ? previewInfo.preview.officialPlannedHours : previewInfo.preview.plannedHoursLevel1).toLocaleString("pt-BR", { minimumFractionDigits: 1 }) + " h"],
                [previewIsOfficial ? "Horas produtivas realizadas" : previewIsRevAtual ? "Realizado — sem produtividade oficial" : previewIsViewRev06 ? "Realizado no cronograma — sem classificação" : previewIsLegacyImportable ? "Horas produtivas — cronograma" : "Horas produtivas", (previewIsOfficial ? previewInfo.preview.officialProductiveActualHours : previewIsRevAtual || previewIsViewRev06 ? previewInfo.preview.actualHoursInScheduleLevel1 : previewIsLegacyImportable ? previewInfo.preview.actualHoursInScheduleLevel1 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 }) + " h"],
                [previewIsOfficial ? "Horas improdutivas realizadas" : previewIsRevAtual ? "Fora do escopo — não é improdutividade" : previewIsViewRev06 ? "Fora do cronograma — não é improdutividade" : previewIsLegacyImportable ? "Horas improdutivas — avulsos" : "Horas improdutivas", (previewIsOfficial ? previewInfo.preview.officialUnproductiveActualHours : previewIsRevAtual || previewIsViewRev06 ? previewInfo.preview.actualHoursOutsideScheduleLevel1 : previewIsLegacyImportable ? previewInfo.preview.actualHoursOutsideScheduleLevel1 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1 }) + " h"],
                ["Realizado / planejado", (previewIsOfficial ? previewInfo.preview.officialPlannedHours : previewInfo.preview.plannedHoursLevel1) > 0 ? `${((previewIsOfficial ? previewInfo.preview.officialProductiveActualHours : previewInfo.preview.actualHoursLevel1) / (previewIsOfficial ? previewInfo.preview.officialPlannedHours : previewInfo.preview.plannedHoursLevel1) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : "não disponível"],
                ["Campos", previewInfo.preview.detectedColumns.length.toLocaleString("pt-BR")],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-blue-100 bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1 text-base font-bold text-blue-950">{value}</div>
                </div>
              ))}
            </div>
            <div className={`rounded-lg border px-3 py-2 text-[11px] ${previewCanImport ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
              {previewIsRevAtual
                ? previewCanImport
                  ? "SQL RevAtual reconhecida: as colunas do cronograma e do planejamento de Gestão/Módulo fora do escopo serão espelhadas como vieram da API. Horas fora do escopo não serão classificadas como improdutivas sem coluna oficial."
                  : `SQL RevAtual reconhecida, mas a importação está bloqueada para não substituir os valores reais do Majaguas. ${previewInfo.preview.validationWarnings.join(" ")}`
                : previewIsViewRev06
                ? previewCanImport
                  ? "View REV06 reconhecida e conciliada: o planejamento vem corrigido pela hierarquia PPSA e os níveis 1 a 4 serão preservados separados na Gestão/Módulo. A View não fornece produtividade oficial separada."
                  : `View REV06 reconhecida, mas a importação está bloqueada para não substituir os valores reais do Majaguas. ${previewInfo.preview.validationWarnings.join(" ")}`
                : previewIsOfficial
                ? "SQL Cronograma Rev03 reconhecida e conciliada: os totais oficiais por Gestão/Módulo e as horas produtivas/improdutivas serão gravados nos projetos."
                : previewIsLegacyImportable
                  ? "SQL anterior/Rev02 reconhecida e importável: o sistema consolidará a hierarquia PPSA, separará cronograma e apontamentos avulsos e calculará Gestão/Módulo internamente."
                : previewHasRev03
                  ? `SQL Rev03 detectada, mas importação bloqueada para proteger a base. ${previewInfo.preview.validationWarnings.join(" ")}`
                  : "Importação bloqueada: o retorno não contém o contrato PPSA mínimo para o tratamento interno. Revise o SELECT no endpoint e teste novamente."}
            </div>

            {(previewHasRev03 || previewHasRev06 || previewHasRevAtual) && !previewCanImport && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                <div className="font-bold">Diagnóstico de reconciliação antes da publicação</div>
                <div className="mt-1">Cobertura: {previewInfo.preview.projectCoveragePct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% · {previewInfo.preview.missingProjectCount.toLocaleString("pt-BR")} projeto(s) da base não vieram na prévia.</div>
                {previewInfo.preview.referenceProject122 && (
                  <div className="mt-1">Majaguas #122 retornado: {previewInfo.preview.referenceProject122.plannedHours.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} h planejadas, {previewIsRevAtual ? `${previewInfo.preview.referenceProject122.actualHours.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} h em HORAS_TOTAL (sem produtividade separada)` : `${previewInfo.preview.referenceProject122.actualHours.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} h realizadas.`}</div>
                )}
                <div className="mt-1 font-semibold">Ajuste o SELECT/View no endpoint e clique novamente em “Testar conexão + analisar retorno”. Nenhum dado desta prévia divergente será publicado.</div>
              </div>
            )}

            {/* Comparativo de Projetos Novos x Atualizados */}
            {previewInfo.preview.comparison && (
              <div className="rounded-xl border border-indigo-200 bg-white p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-indigo-600" />
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Comparativo com a base atual
                    </h4>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      {previewInfo.preview.comparison.newProjectsCount} projeto(s) novo(s)
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 border border-blue-300">
                      {previewInfo.preview.comparison.updatedProjectsCount} projeto(s) a atualizar
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Coluna 1: Novos */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 space-y-2">
                    <div className="flex items-center justify-between font-bold text-emerald-950 text-[11px]">
                      <span>Projetos que serão adicionados</span>
                      <span>{previewInfo.preview.comparison.newProjectsCount}</span>
                    </div>
                    {previewInfo.preview.comparison.newProjects.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic">Todos os projetos da API já constam cadastrados na base.</p>
                    ) : (
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                        {previewInfo.preview.comparison.newProjects.map((p) => (
                          <div key={p.code} className="text-[11px] bg-white rounded border border-emerald-100 px-2 py-1 flex items-center justify-between">
                            <span className="font-semibold text-slate-800">#{p.code} · {p.name}</span>
                            <span className="text-[10px] text-slate-500">{p.client}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Coluna 2: Atualizados */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                    <div className="flex items-center justify-between font-bold text-blue-950 text-[11px]">
                      <span>Projetos existentes com cronograma atualizado</span>
                      <span>{previewInfo.preview.comparison.updatedProjectsCount}</span>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {previewInfo.preview.comparison.updatedProjects.map((p) => (
                        <div key={p.code} className="text-[11px] bg-white rounded border border-blue-100 px-2 py-1 flex items-center justify-between">
                          <span className="font-semibold text-slate-800">#{p.code} · {p.name}</span>
                          <span className="text-[10px] text-slate-500">{p.client}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[0.8fr_0.8fr_1.8fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800"><Database className="h-3.5 w-3.5 text-blue-700" />Níveis</div>
                <div className="space-y-1 text-[11px] text-slate-600">
                  {previewInfo.preview.levelCounts.map((item) => <div key={item.level} className="flex justify-between"><span>Nível {item.level}</span><strong>{item.count.toLocaleString("pt-BR")}</strong></div>)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-2 text-xs font-bold text-slate-800">Status de atividade</div>
                <div className="space-y-1 text-[11px] text-slate-600">
                  {previewInfo.preview.statusCounts.slice(0, 6).map((item) => <div key={item.status} className="flex justify-between gap-2"><span className="truncate">{item.status}</span><strong>{item.count.toLocaleString("pt-BR")}</strong></div>)}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-800">Amostra dos primeiros registros</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[10px]">
                    <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Projeto</th><th className="px-2 py-1.5">Cliente</th><th className="px-2 py-1.5">PPSA / Descrição</th><th className="px-2 py-1.5">Nível</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5 text-right">Plan./Real.</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{previewInfo.preview.sampleRows.map((row, index) => <tr key={`${row.projectCode}-${row.ppsaCode}-${index}`}><td className="max-w-[150px] truncate px-2 py-1.5 font-semibold text-slate-800">#{row.projectCode} · {row.projectName}</td><td className="px-2 py-1.5 text-slate-600">{row.client}</td><td className="max-w-[230px] truncate px-2 py-1.5"><span className="font-mono text-blue-800">{row.ppsaCode}</span> · {row.description}</td><td className="px-2 py-1.5">{row.level}</td><td className="px-2 py-1.5">{row.status}</td><td className="whitespace-nowrap px-2 py-1.5 text-right">{row.plannedHours.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} / {row.actualHours.toLocaleString("pt-BR", { minimumFractionDigits: 1 })} h</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Card Inferior: Histórico de Atualizações & Rollback */}
      <Card className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-700" />
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Histórico de Atualizações & Rollback
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Trilha de auditoria completa de todas as versões carregadas com possibilidade de restauração de versões anteriores.
          </p>
        </div>

        {/* Tabela Idêntica ao Print Anexo */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/90 bg-slate-50/80 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4 text-left font-semibold">DATA / HORA</th>
                <th className="py-3 px-4 text-left font-semibold">ARQUIVO / IDENTIFICADOR</th>
                <th className="py-3 px-4 text-left font-semibold">ORIGEM</th>
                <th className="py-3 px-4 text-left font-semibold">RESPONSÁVEL</th>
                <th className="py-3 px-4 text-center font-semibold">LINHAS</th>
                <th className="py-3 px-4 text-center font-semibold">STATUS</th>
                <th className="py-3 px-4 text-right pr-6 font-semibold">AÇÃO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loadingRuns ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    Carregando histórico de sincronizações...
                  </td>
                </tr>
              ) : (runsData?.items || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                    Nenhuma sincronização registrada.
                  </td>
                </tr>
              ) : (
                (runsData?.items || []).map((run) => {
                  const isCurrentActive = run.status === "publicada_ativa";

                  return (
                    <tr
                      key={run.id}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        isCurrentActive ? "bg-emerald-50/20" : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {formatDateHour(run.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] font-bold text-slate-900 whitespace-nowrap">
                        {run.fileIdentifier}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {run.origin}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {run.responsible}
                      </td>
                      <td className="py-3 px-4 text-center font-medium text-slate-800 whitespace-nowrap">
                        {Number(run.rowsImported || 0).toLocaleString("pt-BR")}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {isCurrentActive ? (
                          <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                            PUBLICADA ATIVA
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            Publicada
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right pr-6 whitespace-nowrap">
                        {!isCurrentActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rollbackMutation.mutate({ runId: run.id })}
                            disabled={rollbackMutation.isPending}
                            className="h-7 px-2.5 text-[11px] font-medium text-slate-700 border-slate-300 hover:bg-slate-100 gap-1.5 shadow-2xs"
                          >
                            <RotateCcw className="h-3 w-3 text-slate-500" />
                            Restaurar (Rollback)
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic pr-2">
                            Versão em uso
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé da Tabela: Paginação Idêntica ao Print */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-slate-100 text-xs text-slate-500">
          <div>
            Exibindo <span className="font-semibold text-slate-700">{startItem}–{endItem}</span> de{" "}
            <span className="font-semibold text-slate-700">{totalItems}</span> atualizações
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-7 px-2.5 text-xs text-slate-600 border-slate-200 hover:bg-slate-50 gap-1"
            >
              <ChevronLeft className="h-3 w-3" />
              Anterior
            </Button>

            {totalItems > 0 && Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
              <Button
                key={pNum}
                size="sm"
                variant={pNum === page ? "default" : "outline"}
                onClick={() => setPage(pNum)}
                className={`h-7 w-7 p-0 text-xs font-semibold ${
                  pNum === page
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {pNum}
              </Button>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-7 px-2.5 text-xs text-slate-600 border-slate-200 hover:bg-slate-50 gap-1"
            >
              Próxima
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
