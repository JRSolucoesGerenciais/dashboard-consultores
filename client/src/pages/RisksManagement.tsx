import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle, Clock3, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GlobalFilterBar } from "@/components/GlobalFilterBar";
import { matchesProjectDateRange, sameFilterValue, useGlobalFilters } from "@/contexts/GlobalFilterContext";

export default function RisksManagement() {
  const { data: projectsList = [] } = trpc.projects.list.useQuery();
  const { activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd, selectedProjectId: globalSelectedProjectId, setProjectFilter } = useGlobalFilters();
  const scopedProjects = useMemo(() => projectsList.filter((project) => {
    if (activeFilter === "ativo" && !project.isActive) return false;
    if (activeFilter === "inativo" && project.isActive) return false;
    if (clientFilter !== "todos" && !sameFilterValue(project.client, clientFilter)) return false;
    if (projectFilter !== "todos" && String(project.id) !== projectFilter && project.code !== projectFilter) return false;
    if (sponsorFilter !== "todos" && !sameFilterValue(project.sponsor || "Não informado", sponsorFilter)) return false;
    if (typeFilter !== "todos" && !sameFilterValue(project.projectTypeDescription || project.projectType || "Não informado", typeFilter)) return false;
    return matchesProjectDateRange(project, dateStart, dateEnd);
  }), [projectsList, activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd]);
  const initialId = globalSelectedProjectId ? String(globalSelectedProjectId) : (projectFilter && projectFilter !== "todos" ? projectFilter : "");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialId);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  // Formulário de novo risco
  const [title, setTitle] = useState<string>("");
  const [category, setCategory] = useState<string>("Cronograma");
  const [severity, setSeverity] = useState<"baixo" | "medio" | "alto" | "critico">("medio");
  const [probability, setProbability] = useState<"baixo" | "medio" | "alto">("medio");
  const [impact, setImpact] = useState<string>("");
  const [mitigationPlan, setMitigationPlan] = useState<string>("");
  const [owner, setOwner] = useState<string>("Bruno Marin");
  const [dueDate, setDueDate] = useState<string>("2026-09-30");

  useEffect(() => {
    if (projectFilter && projectFilter !== "todos" && scopedProjects.some((project) => String(project.id) === projectFilter || project.code === projectFilter)) {
      setSelectedProjectId(projectFilter);
    } else if (!scopedProjects.some((project) => String(project.id) === selectedProjectId)) {
      setSelectedProjectId(scopedProjects[0]?.id ? String(scopedProjects[0].id) : "");
    }
  }, [projectFilter, scopedProjects, selectedProjectId]);

  const handleProjectChange = (value: string) => {
    setSelectedProjectId(value);
    setProjectFilter(value);
  };

  const { data: projectData } = trpc.projects.getById.useQuery({
    id: parseInt(selectedProjectId, 10),
  }, { enabled: Boolean(selectedProjectId) });

  const utils = trpc.useUtils();
  const addRiskMutation = trpc.projects.addRisk.useMutation({
    onSuccess: () => {
      toast.success("Risco registrado com sucesso!");
      setIsDialogOpen(false);
      setTitle("");
      setImpact("");
      setMitigationPlan("");
      utils.projects.getById.invalidate();
      utils.projects.getPortfolioMetrics.invalidate();
    },
    onError: (err) => {
      toast.error(`Erro: ${err.message}`);
    },
  });

  const updateStatusMutation = trpc.projects.updateRiskStatus.useMutation({
    onSuccess: () => {
      toast.success("Status do risco atualizado!");
      utils.projects.getById.invalidate();
      utils.projects.getPortfolioMetrics.invalidate();
    },
  });

  const handleCreateRisk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !impact || !mitigationPlan) {
      toast.error("Preencha título, impacto e plano de mitigação.");
      return;
    }

    addRiskMutation.mutate({
      projectId: parseInt(selectedProjectId, 10),
      title,
      category,
      severity,
      probability,
      impact,
      mitigationPlan,
      owner,
      dueDate,
    });
  };

  const risks = projectData?.risks || [];

  return (
    <div className="space-y-6">
      {/* BARRA DE FILTROS GLOBAIS FIXA */}
      <GlobalFilterBar showProjectSelector={true} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            Gestão de Riscos, Problemas e Decisões
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Matriz viva de riscos alinhada ao PMBOK: registro de causas, impactos, planos de mitigação e donos da ação.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-64">
            <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Selecione o projeto" />
              </SelectTrigger>
              <SelectContent>
                {scopedProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()} className="text-xs">
                    #{p.code} - {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-900 hover:bg-blue-800 text-white text-xs flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                Novo Risco
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-900">Cadastrar Novo Risco / Problema</DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Preencha os dados do risco para acompanhamento no comitê semanal.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateRisk} className="space-y-3.5 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Título do Risco</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Falta de massa de testes para integração"
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Categoria</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cronograma" className="text-xs">Cronograma</SelectItem>
                        <SelectItem value="Escopo" className="text-xs">Escopo</SelectItem>
                        <SelectItem value="Recurso" className="text-xs">Recurso / Consultor</SelectItem>
                        <SelectItem value="Cliente" className="text-xs">Cliente / Decisão</SelectItem>
                        <SelectItem value="Técnico" className="text-xs">Técnico / Infra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Severidade</Label>
                    <Select value={severity} onValueChange={(val: any) => setSeverity(val)}>
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="baixo" className="text-xs">Baixo</SelectItem>
                        <SelectItem value="medio" className="text-xs">Médio</SelectItem>
                        <SelectItem value="alto" className="text-xs">Alto</SelectItem>
                        <SelectItem value="critico" className="text-xs">Crítico</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Descrição do Impacto</Label>
                  <Textarea
                    rows={2}
                    value={impact}
                    onChange={(e) => setImpact(e.target.value)}
                    placeholder="Qual o reflexo no prazo, custo ou homologação?"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Plano de Mitigação / Resposta</Label>
                  <Textarea
                    rows={2}
                    value={mitigationPlan}
                    onChange={(e) => setMitigationPlan(e.target.value)}
                    placeholder="Qual ação imediata será tomada para anular ou reduzir o risco?"
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Dono da Ação (Owner)</Label>
                    <Input
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Data Limite (Due Date)</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} className="text-xs">
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={addRiskMutation.isPending} className="bg-blue-900 text-white text-xs">
                    {addRiskMutation.isPending ? "Salvando..." : "Salvar Risco"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border-slate-200 bg-slate-50/60 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500">Horas planejadas</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{Number(projectData?.project?.plannedHours || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h</div>
              <div className="mt-1 text-[10px] text-slate-500">Nível 1 consolidado • total do projeto</div>
            </div>
            <Clock3 className="w-5 h-5 text-slate-600" />
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/30 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500">Horas realizadas</div>
              <div className="mt-1 text-2xl font-bold text-blue-900">{Number(projectData?.project?.actualHours || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h</div>
              <div className="mt-1 text-[10px] text-blue-700">Nível 1 consolidado • total do projeto</div>
              <Badge variant="outline" className={`mt-2 text-[10px] ${Number(projectData?.project?.plannedHours || 0) - Number(projectData?.project?.actualHours || 0) >= 0 ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>Saldo: {Number(projectData?.project?.plannedHours || 0) - Number(projectData?.project?.actualHours || 0) >= 0 ? "+" : "−"}{Math.abs(Number(projectData?.project?.plannedHours || 0) - Number(projectData?.project?.actualHours || 0)).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h</Badge>
            </div>
            <Clock3 className="w-5 h-5 text-blue-700" />
          </CardContent>
        </Card>
      </div>

      {/* Lista de Riscos Cadastrados */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">
              Matriz de Riscos do Projeto #{projectData?.project?.code} - {projectData?.project?.name}
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Total de {risks.length} risco(s) registrado(s)
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/70">
                <TableRow>
                  <TableHead className="w-56 text-xs font-semibold text-slate-600">Título / Categoria</TableHead>
                  <TableHead className="w-24 text-xs font-semibold text-slate-600 text-center">Severidade</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-600">Impacto e Mitigação</TableHead>
                  <TableHead className="w-44 text-xs font-semibold text-slate-600">Responsável / Prazo</TableHead>
                  <TableHead className="w-28 text-xs font-semibold text-slate-600 text-center">Status</TableHead>
                  <TableHead className="w-28 text-xs font-semibold text-slate-600 text-right pr-6">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {risks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-xs text-slate-400">
                      Nenhum risco cadastrado para este projeto.
                    </TableCell>
                  </TableRow>
                ) : (
                  risks.map((risk) => (
                    <TableRow key={risk.id} className="hover:bg-slate-50/70 transition-colors">
                      <TableCell className="py-3">
                        <div className="font-semibold text-xs text-slate-900">{risk.title}</div>
                        <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          {risk.category}
                        </span>
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase font-bold ${
                            risk.severity === "critico"
                              ? "bg-rose-100 text-rose-800 border-rose-300"
                              : risk.severity === "alto"
                              ? "bg-amber-100 text-amber-800 border-amber-300"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {risk.severity}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-xs">
                        <div className="text-slate-800">
                          <strong>Impacto:</strong> {risk.impact}
                        </div>
                        <div className="text-slate-600 mt-1 text-[11px] bg-slate-50 p-2 rounded border border-slate-100">
                          <strong>Mitigação:</strong> {risk.mitigationPlan}
                        </div>
                      </TableCell>

                      <TableCell className="text-xs text-slate-700">
                        <div className="font-medium text-slate-900">{risk.owner}</div>
                        <div className="text-[10px] text-slate-500">Prazo: {risk.dueDate || "Sem data"}</div>
                      </TableCell>

                      <TableCell className="text-center">
                        {risk.status === "resolvido" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                            Resolvido
                          </Badge>
                        ) : risk.status === "em_mitigacao" ? (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">
                            Em Mitigação
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                            Aberto
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right pr-6">
                        {risk.status !== "resolvido" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              updateStatusMutation.mutate({
                                riskId: risk.id,
                                status: "resolvido",
                              })
                            }
                            className="h-7 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1 font-semibold"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Resolver
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Finalizado</span>
                        )}
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
  );
}
