import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { matchesProjectDateRange, sameFilterValue, useGlobalFilters } from "@/contexts/GlobalFilterContext";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  History,
  Paperclip,
  PieChart as PieIcon,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statusColors = {
  verde: "#16a34a",
  amarelo: "#f59e0b",
  vermelho: "#ef4444",
};

function numberBR(value: unknown, decimals = 0) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function WeeklyCheckin() {
  const [, setLocation] = useLocation();
  const {
    activeFilter,
    clientFilter,
    projectFilter,
    sponsorFilter,
    typeFilter,
    dateStart,
    dateEnd,
    selectedProjectId: globalSelectedProjectId,
    setProjectFilter,
  } = useGlobalFilters();

  const { data: allProjects = [], isLoading: loadingProjects } = trpc.projects.list.useQuery();

  const scopedProjects = useMemo(() => {
    return allProjects.filter((project) => {
      if (activeFilter === "ativo" && !project.isActive) return false;
      if (activeFilter === "inativo" && project.isActive) return false;
      if (clientFilter !== "todos" && !sameFilterValue(project.client, clientFilter)) return false;
      if (projectFilter !== "todos" && String(project.id) !== projectFilter && project.code !== projectFilter) return false;
      if (sponsorFilter !== "todos" && !sameFilterValue(project.sponsor || "Não informado", sponsorFilter)) return false;
      if (typeFilter !== "todos" && !sameFilterValue(project.projectTypeDescription || project.projectType || "Não informado", typeFilter)) return false;
      return matchesProjectDateRange(project, dateStart, dateEnd);
    });
  }, [allProjects, activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd]);

  const activeProject = useMemo(() => {
    if (globalSelectedProjectId) {
      const match = scopedProjects.find((p) => p.id === globalSelectedProjectId);
      if (match) return match;
    }
    if (projectFilter !== "todos") {
      const match = scopedProjects.find((p) => String(p.id) === projectFilter || p.code === projectFilter);
      if (match) return match;
    }
    return scopedProjects[0];
  }, [scopedProjects, globalSelectedProjectId, projectFilter]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [weekReference, setWeekReference] = useState<string>("");
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>("todas");
  const [authorName, setAuthorName] = useState<string>("");
  const [authorRole, setAuthorRole] = useState<string>("");
  const [ragStatus, setRagStatus] = useState<"verde" | "amarelo" | "vermelho">("verde");
  const [physicalProgressPct, setPhysicalProgressPct] = useState<string>("");
  const [whatOccurred, setWhatOccurred] = useState<string>("");
  const [nextSteps, setNextSteps] = useState<string>("");
  const [criticalAttention, setCriticalAttention] = useState<string>("");
  const [clientDecisionsNeeded, setClientDecisionsNeeded] = useState<string>("");
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: number; type: string; base64: string }>>([]);

  useEffect(() => {
    if (activeProject) {
      setSelectedProjectId(String(activeProject.id));
    } else {
      setSelectedProjectId("");
    }
  }, [activeProject]);

  const { data: projectDetail, refetch: refetchProject } = trpc.projects.getById.useQuery(
    { id: activeProject ? activeProject.id : 0 },
    { enabled: Boolean(activeProject) }
  );

  const weeklyUpdates = useMemo(() => projectDetail?.weeklyUpdates || [], [projectDetail?.weeklyUpdates]);

  const weekOptions = useMemo(() => {
    const list = Array.from(new Set(weeklyUpdates.map((u) => u.weekReference).filter(Boolean)));
    return list;
  }, [weeklyUpdates]);

  const filteredUpdates = useMemo(() => {
    if (selectedWeekFilter === "todas") return weeklyUpdates;
    return weeklyUpdates.filter((u) => u.weekReference === selectedWeekFilter);
  }, [weeklyUpdates, selectedWeekFilter]);

  const pieData = useMemo(() => {
    const source = filteredUpdates;
    const verde = source.filter((u) => u.ragStatus === "verde").length;
    const amarelo = source.filter((u) => u.ragStatus === "amarelo").length;
    const vermelho = source.filter((u) => u.ragStatus === "vermelho").length;
    return [
      { name: "Verde (No Prazo)", value: verde, key: "verde" },
      { name: "Amarelo (Atenção)", value: amarelo, key: "amarelo" },
      { name: "Vermelho (Crítico)", value: vermelho, key: "vermelho" },
    ].filter((item) => item.value > 0);
  }, [filteredUpdates, weeklyUpdates]);

  const utils = trpc.useUtils();
  const addMutation = trpc.projects.addWeeklyUpdate.useMutation({
    onSuccess: () => {
      toast.success("Apontamento semanal registrado com sucesso!");
      utils.projects.getById.invalidate();
      utils.projects.list.invalidate();
      utils.projects.getPortfolioMetrics.invalidate();
      refetchProject();
      if (activeProject) {
        setLocation(`/projeto/${activeProject.id}`);
      }
    },
    onError: (err) => {
      toast.error(`Erro ao salvar: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !selectedProjectId) {
      toast.error("Nenhum projeto selecionado nos filtros globais.");
      return;
    }
    if (!weekReference.trim()) {
      toast.error("Informe a semana de referência.");
      return;
    }
    if (!authorName.trim()) {
      toast.error("Informe o responsável pelo preenchimento.");
      return;
    }
    if (!whatOccurred || !nextSteps) {
      toast.error("Preencha 'O que ocorreu' e 'Próximos passos'.");
      return;
    }

    addMutation.mutate({
      projectId: parseInt(selectedProjectId, 10),
      weekReference: weekReference.trim(),
      authorName: authorName.trim(),
      authorRole: authorRole.trim() || "Gerente de Projetos",
      ragStatus,
      physicalProgressPct: String(physicalProgressPct || "0"),
      spiValue: "1.00",
      cpiValue: "1.00",
      hoursConsumedWeek: "0.00",
      whatOccurred: whatOccurred.trim(),
      nextSteps: nextSteps.trim(),
      criticalAttention: criticalAttention.trim(),
      clientDecisionsNeeded: clientDecisionsNeeded.trim(),
      attachments: attachedFiles.map((f) => ({
        fileName: f.name,
        fileBase64: f.base64,
        contentType: f.type,
      })),
    });
  };

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    const processed: Array<{ name: string; size: number; type: string; base64: string }> = [];
    for (const file of fileList) {
      if (file.size > 15 * 1024 * 1024) {
        toast.error(`Arquivo ${file.name} excede o limite de 15MB.`);
        continue;
      }
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const base64 = btoa(binary);
      processed.push({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        base64,
      });
    }
    setAttachedFiles((prev) => [...prev, ...processed]);
    event.target.value = "";
  };

  const removeAttachment = (indexToRemove: number) => {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  if (loadingProjects) {
    return <div className="py-12 text-center text-sm text-slate-500">Carregando projetos...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <GlobalFilterBar showProjectSelector={true} />

      {!activeProject ? (
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="py-16 text-center space-y-3">
            <h2 className="text-lg font-bold text-slate-800">Nenhum projeto atende aos filtros globais selecionados</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Ajuste o Cliente, Projeto Ativo, Gestor ou Tipo na barra de filtros acima para habilitar o check-in do projeto.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                <span className="font-semibold text-blue-900">Check-in Semanal</span>
                <span>•</span>
                <span>{activeProject.client}</span>
                <span>•</span>
                <span>{activeProject.projectTypeDescription || activeProject.projectType || "Projeto"}</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-900" />
                Apontamento Semanal • #{activeProject.code} - {activeProject.name}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Acompanhe o histórico do projeto filtrado, registre o progresso e relate pontos de atenção.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge className="border border-blue-200 bg-blue-50 text-blue-900 text-xs py-1 px-3">
                {scopedProjects.length} {scopedProjects.length === 1 ? "projeto filtrado" : "projetos no escopo"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/projeto/${activeProject.id}`)}
                className="text-xs"
              >
                Ver Detalhe do Projeto
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="border-slate-200 bg-slate-50/60 shadow-xs">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-500">Horas planejadas</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{numberBR(projectDetail?.project.plannedHours, 1)} h</div>
                  <div className="mt-1 text-[10px] text-slate-500">Nível 1 consolidado • total do projeto</div>
                </div>
                <Clock3 className="w-5 h-5 text-slate-600" />
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50/30 shadow-xs">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-500">Horas realizadas</div>
                  <div className="mt-1 text-2xl font-bold text-blue-900">{numberBR(projectDetail?.project.actualHours, 1)} h</div>
                  <div className="mt-1 text-[10px] text-blue-700">Nível 1 consolidado • total do projeto</div>
                  <Badge variant="outline" className={`mt-2 text-[10px] ${Number(projectDetail?.project.plannedHours || 0) - Number(projectDetail?.project.actualHours || 0) >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo: {Number(projectDetail?.project.plannedHours || 0) - Number(projectDetail?.project.actualHours || 0) >= 0 ? "+" : "−"}{numberBR(Math.abs(Number(projectDetail?.project.plannedHours || 0) - Number(projectDetail?.project.actualHours || 0)), 1)} h</Badge>
                </div>
                <Clock3 className="w-5 h-5 text-blue-700" />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="border-slate-200/80 shadow-xs">
                  <CardHeader className="p-4 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold text-slate-900">1. Identificação do Projeto e Referência</CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      O projeto respeita estritamente o filtro global. Selecione a semana do apontamento.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Projeto Selecionado</Label>
                      <select
                        value={selectedProjectId}
                        onChange={(e) => {
                          setSelectedProjectId(e.target.value);
                          setProjectFilter(e.target.value);
                        }}
                        className="w-full h-8 text-xs rounded-md border border-slate-200 bg-white px-2 font-semibold text-blue-950"
                      >
                        {scopedProjects.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            #{p.code} - {p.name} ({p.client})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Semana de Referência</Label>
                      <Input
                        value={weekReference}
                        onChange={(e) => setWeekReference(e.target.value)}
                        placeholder="Ex: Semana 38 / 2026 (15/09 a 19/09)"
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Responsável pelo Preenchimento</Label>
                      <Input
                        value={authorName}
                        onChange={(e) => setAuthorName(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Cargo / Papel</Label>
                      <Input
                        value={authorRole}
                        onChange={(e) => setAuthorRole(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200/80 shadow-xs">
                  <CardHeader className="p-4 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold text-slate-900">2. Indicadores PMBOK da Semana</CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Classificação RAG, avanço físico e índices de desempenho da semana
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Situação Geral do Projeto (RAG)</Label>
                      <RadioGroup
                        value={ragStatus}
                        onValueChange={(val: "verde" | "amarelo" | "vermelho") => setRagStatus(val)}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1"
                      >
                        <label
                          htmlFor="r-verde"
                          className={`flex items-center gap-2 border p-3 rounded-lg cursor-pointer transition ${
                            ragStatus === "verde" ? "bg-emerald-50 border-emerald-400" : "hover:bg-slate-50"
                          }`}
                        >
                          <RadioGroupItem value="verde" id="r-verde" />
                          <div>
                            <div className="font-bold text-xs text-emerald-900">Verde (No Prazo)</div>
                            <div className="text-[10px] text-emerald-700">Entregas dentro do planejado</div>
                          </div>
                        </label>

                        <label
                          htmlFor="r-amarelo"
                          className={`flex items-center gap-2 border p-3 rounded-lg cursor-pointer transition ${
                            ragStatus === "amarelo" ? "bg-amber-50 border-amber-400" : "hover:bg-slate-50"
                          }`}
                        >
                          <RadioGroupItem value="amarelo" id="r-amarelo" />
                          <div>
                            <div className="font-bold text-xs text-amber-900">Amarelo (Atenção)</div>
                            <div className="text-[10px] text-amber-700">Pequeno desvio ou gargalo</div>
                          </div>
                        </label>

                        <label
                          htmlFor="r-vermelho"
                          className={`flex items-center gap-2 border p-3 rounded-lg cursor-pointer transition ${
                            ragStatus === "vermelho" ? "bg-rose-50 border-rose-400" : "hover:bg-slate-50"
                          }`}
                        >
                          <RadioGroupItem value="vermelho" id="r-vermelho" />
                          <div>
                            <div className="font-bold text-xs text-rose-900">Vermelho (Crítico)</div>
                            <div className="text-[10px] text-rose-700">Risco severo de cronograma</div>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>

                    <div className="max-w-xs pt-1 space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Avanço Físico (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        placeholder="Ex: 74,5"
                        value={physicalProgressPct}
                        onChange={(e) => setPhysicalProgressPct(e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200/80 shadow-xs">
                  <CardHeader className="p-4 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold text-slate-900">3. Relato Gerencial e Tomada de Decisão</CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Fatos da semana, próximos passos e observações para alinhamento com o patrocinador
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-800">
                        O que ocorreu na semana? <span className="text-rose-500">*</span>
                      </Label>
                      <Textarea
                        rows={3}
                        value={whatOccurred}
                        onChange={(e) => setWhatOccurred(e.target.value)}
                        placeholder="Descreva as entregas concluídas, homologações feitas e principais avanços..."
                        className="text-xs leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-800">
                        Próximos passos planejados <span className="text-rose-500">*</span>
                      </Label>
                      <Textarea
                        rows={2}
                        value={nextSteps}
                        onChange={(e) => setNextSteps(e.target.value)}
                        placeholder="Atividades agendadas para a próxima semana..."
                        className="text-xs leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                          Ponto de Atenção Crítico (Interno CS)
                        </Label>
                        <Textarea
                          rows={2}
                          value={criticalAttention}
                          onChange={(e) => setCriticalAttention(e.target.value)}
                          placeholder="Gargalos técnicos, sobrecarga de consultor..."
                          className="text-xs leading-relaxed border-amber-200 bg-amber-50/30"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          Decisões Necessárias do Cliente / Sponsor
                        </Label>
                        <Textarea
                          rows={2}
                          value={clientDecisionsNeeded}
                          onChange={(e) => setClientDecisionsNeeded(e.target.value)}
                          placeholder="Aprovações de regras, liberação de ambientes, aceites..."
                          className="text-xs leading-relaxed border-blue-200 bg-blue-50/30"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200/80 shadow-xs">
                  <CardHeader className="p-4 border-b border-slate-100">
                    <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-blue-900" />
                      4. Anexos do Check-in
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Envie atas, evidências, planilhas ou relatórios de homologação (PDF, XLS, XLSX, DOCX, imagens até 15MB).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs">
                        <Upload className="w-3.5 h-3.5 text-blue-900" />
                        Selecionar arquivos
                        <input
                          type="file"
                          multiple
                          onChange={handleFileSelection}
                          className="hidden"
                        />
                      </label>
                      <span className="text-[11px] text-slate-500">
                        {attachedFiles.length === 0
                          ? "Nenhum arquivo anexado ainda"
                          : `${attachedFiles.length} arquivo(s) preparado(s)`}
                      </span>
                    </div>

                    {attachedFiles.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {attachedFiles.map((file, idx) => (
                          <div
                            key={`${file.name}-${idx}`}
                            className="flex items-center justify-between p-2 rounded-md border border-slate-200 bg-slate-50 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Paperclip className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                              <span className="font-semibold text-slate-800 truncate">{file.name}</span>
                              <span className="text-slate-400 text-[10px]">
                                ({numberBR(file.size / 1024, 0)} KB)
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAttachment(idx)}
                              className="h-6 w-6 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation(`/projeto/${activeProject.id}`)}
                    className="text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={addMutation.isPending}
                    className="bg-blue-900 hover:bg-blue-800 text-white text-xs flex items-center gap-2 px-6"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {addMutation.isPending ? "Salvando..." : "Salvar Apontamento Semanal"}
                  </Button>
                </div>
              </form>
            </div>

            <div className="space-y-6">
              <Card className="border-slate-200/80 shadow-xs">
                <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <PieIcon className="w-4 h-4 text-blue-900" />
                      Status dos Check-ins
                    </CardTitle>
                    <CardDescription className="text-[11px] text-slate-500">
                      Distribuição RAG das semanas registradas
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                  <div className="h-44 w-full">
                    {pieData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        Nenhum check-in registrado ainda
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={42}
                            outerRadius={68}
                            paddingAngle={3}
                          >
                            {pieData.map((entry) => (
                              <Cell
                                key={entry.key}
                                fill={statusColors[entry.key as keyof typeof statusColors] || "#94a3b8"}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: any, name: any) => [`${value} semanas`, name]}
                            contentStyle={{ fontSize: "11px", borderRadius: "6px" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                    <div className="text-center p-2 rounded-md bg-emerald-50/60 border border-emerald-100">
                      <div className="text-[10px] font-semibold text-emerald-800">Verde</div>
                      <div className="text-base font-bold text-emerald-900">
                        {filteredUpdates.filter((u) => u.ragStatus === "verde").length}
                      </div>
                    </div>
                    <div className="text-center p-2 rounded-md bg-amber-50/60 border border-amber-100">
                      <div className="text-[10px] font-semibold text-amber-800">Atenção</div>
                      <div className="text-base font-bold text-amber-900">
                        {filteredUpdates.filter((u) => u.ragStatus === "amarelo").length}
                      </div>
                    </div>
                    <div className="text-center p-2 rounded-md bg-rose-50/60 border border-rose-100">
                      <div className="text-[10px] font-semibold text-rose-800">Crítico</div>
                      <div className="text-base font-bold text-rose-900">
                        {filteredUpdates.filter((u) => u.ragStatus === "vermelho").length}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/80 shadow-xs">
                <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <History className="w-4 h-4 text-blue-900" />
                      Histórico Semanal
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px]">
                      {filteredUpdates.length} {filteredUpdates.length === 1 ? "registro" : "registros"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select
                      value={selectedWeekFilter}
                      onChange={(e) => setSelectedWeekFilter(e.target.value)}
                      className="w-full h-7 text-[11px] rounded border border-slate-200 bg-white px-2 text-slate-800"
                    >
                      <option value="todas">Todas as semanas cadastradas</option>
                      {weekOptions.map((week) => (
                        <option key={week} value={week}>
                          {week}
                        </option>
                      ))}
                    </select>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3 max-h-[460px] overflow-y-auto">
                  {filteredUpdates.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      Nenhum histórico encontrado para esta semana.
                    </div>
                  ) : (
                    filteredUpdates.map((update) => (
                      <div
                        key={update.id}
                        className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-slate-900">{update.weekReference}</span>
                          <Badge
                            className={`text-[10px] ${
                              update.ragStatus === "verde"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                : update.ragStatus === "amarelo"
                                ? "bg-amber-50 text-amber-800 border-amber-300"
                                : "bg-rose-50 text-rose-800 border-rose-300"
                            } border`}
                          >
                            {update.ragStatus === "verde"
                              ? "Verde"
                              : update.ragStatus === "amarelo"
                              ? "Atenção"
                              : "Crítico"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-100">
                          <div>
                            <span className="text-slate-400">Avanço:</span> <strong>{numberBR(update.physicalProgressPct)}%</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">SPI:</span> <strong>{update.spiValue}</strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Horas:</span> <strong>{numberBR(update.hoursConsumedWeek, 1)}h</strong>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">O que ocorreu</div>
                          <p className="text-slate-700 text-[11px] leading-relaxed mt-0.5">{update.whatOccurred}</p>
                        </div>
                        {update.criticalAttention && (
                          <div className="p-2 rounded bg-amber-50/80 border border-amber-200 text-amber-900 text-[11px]">
                            <strong>Atenção:</strong> {update.criticalAttention}
                          </div>
                        )}
                        {update.clientDecisionsNeeded && (
                          <div className="p-2 rounded bg-blue-50/80 border border-blue-200 text-blue-900 text-[11px]">
                            <strong>Decisões:</strong> {update.clientDecisionsNeeded}
                          </div>
                        )}
                        {(update as any).attachments && (update as any).attachments.length > 0 && (
                          <div className="pt-1 border-t border-slate-200/80">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                              <Paperclip className="w-3 h-3 text-blue-800" />
                              Anexos ({(update as any).attachments.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(update as any).attachments.map((att: any) => (
                                <a
                                  key={att.id}
                                  href={att.storageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-slate-200 text-[10px] text-blue-900 hover:bg-blue-50 font-medium truncate max-w-[200px]"
                                  title={att.fileName}
                                >
                                  <Paperclip className="w-2.5 h-2.5 text-blue-700 shrink-0" />
                                  <span className="truncate">{att.fileName}</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
