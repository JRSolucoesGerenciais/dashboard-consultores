import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { OracleApiIntegrationSection } from "@/components/OracleApiIntegrationSection";
import { parseSpreadsheetInBrowser, type ClientParsedSpreadsheet } from "@/lib/clientSpreadsheetParser";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  RefreshCw,
  FileText,
  ShieldCheck,
  Download,
  Database,
  Code2,
  KeyRound,
  Layers,
} from "lucide-react";
import { Link } from "wouter";

type SpreadsheetValidation = {
  valid: boolean;
  fileName: string;
  sheetName: string;
  availableSheets: string[];
  totalRows: number;
  uniqueProjects: number;
  detectedColumns: string[];
  missingCrucialColumns: string[];
  sampleProjects: Array<{ code: string; name: string; client: string; rows: number }>;
  message: string;
};

type SpreadsheetImportResult = SpreadsheetValidation & {
  batchId: number;
  storageKey?: string;
  storageUrl?: string;
  projectsUpdated: number;
  activitiesImported: number;
  masterCatalogPreservedCount: number;
};

async function parseSpreadsheetResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      response.status === 503
        ? "O servidor ficou indisponível durante o upload. Tente novamente; o arquivo agora é enviado diretamente, sem conversão para JSON."
        : `O servidor retornou uma resposta inválida (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "message" in payload
      ? String((payload as { message?: unknown }).message || "Falha no upload")
      : `Falha no upload (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

async function uploadSpreadsheet<T>(
  endpoint: "validate" | "import",
  file: File,
  notes?: string
): Promise<T> {
  // Usamos FormData (multipart/form-data) como estratégia primária, pois
  // atravessa proxies e gateways web (Cloudflare, firewalls corporativos)
  // sem disparar bloqueios de 503 por payload bruto não encapsulado.
  const formData = new FormData();
  formData.append("file", file, file.name);
  if (notes) formData.append("notes", notes);

  const maxAttempts = endpoint === "validate" ? 3 : 1;
  let response: Response | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(`/api/spreadsheets/${endpoint}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      // Se receber 503 do gateway no multipart, faz tentativa com body binário puro
      if ([502, 503, 504].includes(response.status) && attempt < maxAttempts) {
        const params = new URLSearchParams({ fileName: file.name });
        if (notes) params.set("notes", notes);
        const fallbackResponse = await fetch(`/api/spreadsheets/${endpoint}?${params.toString()}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
          credentials: "include",
        }).catch(() => null);
        if (fallbackResponse && fallbackResponse.ok) {
          response = fallbackResponse;
          break;
        }
      }

      if (![502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
  }

  if (!response) {
    throw lastError instanceof Error ? lastError : new Error("O servidor não respondeu ao upload.");
  }
  return parseSpreadsheetResponse<T>(response);
}

export default function SpreadsheetUploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [validationResult, setValidationResult] = useState<ClientParsedSpreadsheet | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressPct, setImportProgressPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: batches = [], refetch: refetchBatches, isLoading: loadingBatches } =
    trpc.projects.getImportBatches.useQuery();

  const utils = trpc.useUtils();
  const beginImportMutation = trpc.projects.beginSpreadsheetImport.useMutation();
  const uploadChunkMutation = trpc.projects.uploadSpreadsheetImportChunk.useMutation();
  const startProcessingMutation = trpc.projects.startProcessingSpreadsheetImport.useMutation();

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.(xls|xlsx)$/i)) {
      toast.error("Formato inválido. Por favor envie um arquivo com extensão .xls ou .xlsx.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Arquivo muito grande. O limite para planilhas é de 50 MB.");
      return;
    }

    setSelectedFile(file);
    setValidationResult(null);
    setIsValidating(true);

    // Estratégia 1: Leitura e validação instantânea no navegador (100% resiliente a limitações de gateway)
    try {
      const clientParsed = await parseSpreadsheetInBrowser(file);
      setValidationResult(clientParsed);
      if (clientParsed.valid) {
        toast.success(`Planilha validada: ${clientParsed.totalRows.toLocaleString("pt-BR")} linhas e ${clientParsed.uniqueProjects} projetos encontrados.`);
      } else {
        toast.error(clientParsed.message);
      }
    } catch (clientErr) {
      // Fallback: Tenta validação remota caso a leitura client-side enfrente incompatibilidade
      try {
        const data = await uploadSpreadsheet<SpreadsheetValidation>("validate", file);
        setValidationResult({ ...data, rows: [] });
        if (data.valid) {
          toast.success(`Planilha validada: ${data.totalRows.toLocaleString("pt-BR")} linhas e ${data.uniqueProjects} projetos encontrados.`);
        } else {
          toast.error(data.message);
        }
      } catch (error) {
        setValidationResult(null);
        toast.error(`Erro ao validar planilha: ${error instanceof Error ? error.message : "Falha desconhecida"}`);
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleExecuteImport = async () => {
    if (!selectedFile || !validationResult?.valid) {
      toast.error("Selecione um arquivo de planilha antes de importar.");
      return;
    }

    setIsImporting(true);
    setImportProgressPct(0);
    try {
      const rows = validationResult.rows;
      if (!rows.length) {
        throw new Error("A planilha foi validada sem linhas disponíveis para importação. Selecione o arquivo novamente.");
      }

      // Cada requisição fica abaixo do limite do gateway. O backend monta os
      // blocos em uma sessão temporária e só grava a base no último passo.
      const chunkSize = 500;
      const totalChunks = Math.ceil(rows.length / chunkSize);
      const session = await beginImportMutation.mutateAsync({
        fileName: selectedFile.name,
        totalChunks,
        totalRows: rows.length,
        notes: notes || undefined,
      });

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        await uploadChunkMutation.mutateAsync({
          sessionId: session.sessionId,
          chunkIndex,
          rows: rows.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize),
        });
        setImportProgressPct(Math.round(((chunkIndex + 1) / totalChunks) * 95));
      }

      // Dispara o processamento assíncrono no servidor (elimina risco de timeout HTTP)
      await startProcessingMutation.mutateAsync({ sessionId: session.sessionId });
      setImportProgressPct(96);

      // Polling do status até que a gravação das tabelas seja concluída
      let completed = false;
      let attempts = 0;
      const maxAttempts = 120; // até 2 minutos

      while (!completed && attempts < maxAttempts) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await utils.projects.getSpreadsheetImportStatus.fetch({ sessionId: session.sessionId });

        if (status.status === "concluida") {
          completed = true;
          setImportProgressPct(100);
          toast.success(
            `Importação concluída com sucesso! ${status.projectsUpdated} projetos atualizados com ${status.activitiesImported.toLocaleString("pt-BR")} linhas operacionais.`
          );
          setSelectedFile(null);
          setValidationResult(null);
          setNotes("");
          setImportProgressPct(0);
          refetchBatches();
          break;
        }

        if (status.status === "erro") {
          throw new Error(status.errorMessage || "Falha durante o processamento das tabelas.");
        }

        // Progresso suave entre 96% e 99% enquanto o banco consolida os projetos
        setImportProgressPct(Math.min(99, 96 + Math.floor(attempts / 20)));
      }

      if (!completed) {
        toast.info("A importação continua em segundo plano no servidor. Você pode acompanhar a conclusão no Histórico de Atualizações.");
        setSelectedFile(null);
        setValidationResult(null);
        setNotes("");
        setImportProgressPct(0);
        refetchBatches();
      }
    } catch (error) {
      toast.error(`Falha na importação: ${error instanceof Error ? error.message : "Falha desconhecida"}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-900 bg-blue-100 px-2.5 py-0.5 rounded">
              Gestão de Dados
            </span>
            <h1 className="text-xl font-bold text-slate-900">Integração API CSAgenda & Carga de Dados</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Conecte diretamente à API intermediária CSAgenda com agendamento, prévia e rollback ou envie planilhas manuais XLS/XLSX.
          </p>
        </div>

        <Link href="/">
          <Button variant="outline" size="sm" className="text-xs">
            Voltar ao Portfólio Geral
          </Button>
        </Link>
      </div>

      {/* Seletor entre Integração API CSAgenda e Carga Manual de Planilha */}
      <Tabs defaultValue="oracle" className="w-full space-y-6">
        <TabsList className="bg-slate-100 p-1 border border-slate-200 rounded-lg">
          <TabsTrigger value="oracle" className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-2xs">
            Conexão com API Intermediária CSAgenda & Rollback
          </TabsTrigger>
          <TabsTrigger value="manual" className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-2xs">
            Carga Manual de Arquivos XLS / XLSX
          </TabsTrigger>
        </TabsList>

        <TabsContent value="oracle" className="space-y-6 m-0">
          <OracleApiIntegrationSection />
        </TabsContent>

        <TabsContent value="manual" className="m-0">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna Esquerda: Área de Upload e Execução */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="p-4 pb-2 border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-blue-900" />
                Carregar Nova Planilha de Projetos
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Arraste o arquivo exportado da query Oracle ou clique no botão para selecionar do computador.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {/* Zona de Drop */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  dragOver
                    ? "border-blue-900 bg-blue-50/50"
                    : selectedFile
                    ? "border-emerald-400 bg-emerald-50/30"
                    : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFile(e.target.files[0]);
                    }
                  }}
                />

                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-900">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-blue-950">
                      {selectedFile ? selectedFile.name : "Clique para selecionar ou arraste o arquivo aqui"}
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Suporta arquivos .xls e .xlsx da consulta "Select select" / "Select dual" (até 50MB com 54 colunas)
                    </p>
                  </div>
                  {selectedFile && (
                    <Badge variant="outline" className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 border-emerald-300">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB selecionados
                    </Badge>
                  )}
                </div>
              </div>

              {/* Status de Validação */}
              {isValidating && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Analisando estrutura de colunas e dados da planilha...
                </div>
              )}

              {validationResult && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-2 ${
                    validationResult.valid
                      ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                      : "bg-rose-50/80 border-rose-200 text-rose-950"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    {validationResult.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                    )}
                    <span>{validationResult.message}</span>
                  </div>

                  {validationResult.valid && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200/60 text-slate-700">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">Aba</span>
                        <span className="font-bold">{validationResult.sheetName}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">Linhas Lidas</span>
                        <span className="font-bold">{validationResult.totalRows.toLocaleString("pt-BR")}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">Projetos Únicos</span>
                        <span className="font-bold">{validationResult.uniqueProjects}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block font-semibold">Colunas</span>
                        <span className="font-bold">{validationResult.detectedColumns.length} colunas</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Observações da Carga */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Observações desta Versão (Opcional)
                </label>
                <Textarea
                  placeholder="Ex.: Planilha atualizada com fechamento da semana 38 e revisão de prazos de clientes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-xs h-20"
                />
              </div>

              {/* Botão de Aplicação */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-[11px] text-slate-500">
                  A importação preserva o catálogo mestre e projetos cadastrais sem cronograma ativo.
                </div>
                <Button
                  onClick={handleExecuteImport}
                  disabled={!selectedFile || !validationResult?.valid || isImporting || isValidating}
                  className="bg-[#CF142B] hover:bg-[#A40F21] text-white text-xs h-9 px-4 gap-2 font-bold shadow-xs"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Enviando blocos... {importProgressPct}%
                    </>
                  ) : (
                    <>
                      <Database className="w-3.5 h-3.5" />
                      Atualizar Base no Sistema
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Prévia dos Projetos Detectados */}
          {validationResult?.sampleProjects && validationResult.sampleProjects.length > 0 && (
            <Card className="border-slate-200 shadow-xs">
              <CardHeader className="p-4 pb-2 border-b border-slate-100">
                <CardTitle className="text-xs font-bold text-slate-800">
                  Amostra dos Projetos Encontrados no Arquivo
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-50/70">
                    <TableRow>
                      <TableHead className="text-[11px] font-semibold text-slate-600 py-2">Código</TableHead>
                      <TableHead className="text-[11px] font-semibold text-slate-600">Projeto</TableHead>
                      <TableHead className="text-[11px] font-semibold text-slate-600">Cliente</TableHead>
                      <TableHead className="text-[11px] font-semibold text-slate-600 text-right pr-4">Linhas de Atividade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationResult.sampleProjects.map((p) => (
                      <TableRow key={p.code} className="hover:bg-slate-50/50">
                        <TableCell className="py-2 font-bold text-xs text-blue-900">#{p.code}</TableCell>
                        <TableCell className="text-xs font-medium text-slate-800">{p.name}</TableCell>
                        <TableCell className="text-xs text-slate-600">{p.client}</TableCell>
                        <TableCell className="text-xs text-right pr-4 font-semibold text-slate-700">{p.rows}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Coluna Direita: Regras de Carga e Histórico de Atualizações */}
        <div className="space-y-5">
          {/* Instruções de Governança */}
          <Card className="border-slate-200 shadow-xs bg-slate-50/60">
            <CardHeader className="p-4 pb-2 border-b border-slate-200/60">
              <CardTitle className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#CF142B]" />
                Regras de Carga e Segurança
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2.5 text-xs text-slate-600">
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-900 mt-1.5 shrink-0"></span>
                <span>
                  <strong>Não precisa reenviar no chat:</strong> toda planilha enviada por esta tela atualiza automaticamente o banco de dados oficial.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-900 mt-1.5 shrink-0"></span>
                <span>
                  <strong>Preservação Mestre:</strong> projetos cadastrados sem linhas de cronograma permanecem disponíveis com indicadores zerados.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-900 mt-1.5 shrink-0"></span>
                <span>
                  <strong>Sem duplicidade de horas:</strong> o cálculo de horas apontadas consolida os registros no nível 1 conforme padrão PMBOK.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-900 mt-1.5 shrink-0"></span>
                <span>
                  <strong>Versionamento:</strong> cada arquivo é salvo no armazenamento seguro e registrado no histórico de auditoria abaixo.
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-indigo-200 shadow-xs bg-indigo-50/30">
            <CardHeader className="p-4 pb-2 border-b border-indigo-100">
              <CardTitle className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-indigo-700" />
                Importação automática por API
              </CardTitle>
              <CardDescription className="text-xs text-slate-600">
                Integre o ERP ou a consulta operacional sem precisar enviar arquivos manualmente.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-2.5 text-[11px] text-slate-600">
              <div className="rounded-md border border-indigo-100 bg-white p-2 font-mono text-[10px] text-indigo-950 break-all">
                POST /api/integrations/project-import
              </div>
              <div className="flex items-start gap-2"><KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-700" /><span>Autenticação por <strong>Authorization: Bearer &lt;PROJECT_IMPORT_API_KEY&gt;</strong> ou cabeçalho <strong>x-api-key</strong>.</span></div>
              <div className="rounded-md border border-indigo-100 bg-white p-2 font-mono text-[10px] leading-relaxed text-slate-700 whitespace-pre-wrap">{`{
  "source": "ERP CS",
  "projects": [{
    "code": "200",
    "name": "Implantação ERP",
    "client": "USL",
    "activities": [{
      "ppsaCode": "200.1.0.0",
      "description": "Planejamento",
      "level": 1,
      "plannedHours": 120,
      "actualHours": 42.5,
      "progressPct": 35,
      "plannedStart": "2026-09-01",
      "plannedEnd": "2026-09-30"
    }]
  }]
}`}</div>
              <p><strong>Regra de atualização:</strong> o lote substitui as atividades dos projetos enviados, recalcula horas no Nível 1 e preserva os demais projetos do catálogo mestre.</p>
              <p><strong>Pré-requisito:</strong> configurar a variável segura <code>PROJECT_IMPORT_API_KEY</code> no ambiente do servidor.</p>
            </CardContent>
          </Card>

          {/* Histórico de Cargas Anteriores */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="p-4 pb-2 border-b border-slate-100 flex items-center justify-between">
              <CardTitle className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                Histórico de Cargas
              </CardTitle>
              <button
                type="button"
                onClick={() => refetchBatches()}
                className="text-[11px] text-blue-900 font-semibold hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Atualizar
              </button>
            </CardHeader>
            <CardContent className="p-3">
              {loadingBatches ? (
                <div className="text-center py-6 text-xs text-slate-400">Carregando histórico...</div>
              ) : batches.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">Nenhuma carga registrada ainda.</div>
              ) : (
                <div className="space-y-2.5">
                  {batches.map((b) => (
                    <div key={b.id} className="p-2.5 rounded-lg border border-slate-200 bg-white text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 truncate max-w-[160px]">{b.fileName}</span>
                        <Badge className="text-[9px] bg-emerald-100 text-emerald-800 border-emerald-200">
                          {b.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center justify-between">
                        <span>{b.projectCount} projetos • {b.rowsImported.toLocaleString("pt-BR")} linhas</span>
                        <span>{b.importedAt ? new Date(b.importedAt).toLocaleDateString("pt-BR") : ""}</span>
                      </div>
                      {b.storageUrl && (
                        <a
                          href={b.storageUrl}
                          download={b.fileName}
                          className="inline-flex items-center gap-1 text-[10px] text-blue-900 font-semibold hover:underline pt-1"
                        >
                          <Download className="w-3 h-3" />
                          Baixar versão armazenada
                        </a>
                      )}
                      {b.notes && (
                        <p className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-100">
                          {b.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
