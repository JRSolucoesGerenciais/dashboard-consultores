import React, { useEffect, useMemo, useState } from "react";
import { currentDateIso, matchesProjectDateRange, sameFilterValue, useGlobalFilters, type GlobalFilterInput } from "@/contexts/GlobalFilterContext";
import { trpc } from "@/lib/trpc";
import { Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GlobalFilterBar({ showProjectSelector = true }: { showProjectSelector?: boolean }) {
  const applied = useGlobalFilters();
  const { data: allProjects = [] } = trpc.projects.list.useQuery();
  const [draft, setDraft] = useState<GlobalFilterInput>({
    activeFilter: applied.activeFilter,
    clientFilter: applied.clientFilter,
    projectFilter: applied.projectFilter,
    sponsorFilter: applied.sponsorFilter,
    typeFilter: applied.typeFilter,
    dateStart: applied.dateStart,
    dateEnd: applied.dateEnd,
  });

  useEffect(() => {
    setDraft({
      activeFilter: applied.activeFilter,
      clientFilter: applied.clientFilter,
      projectFilter: applied.projectFilter,
      sponsorFilter: applied.sponsorFilter,
      typeFilter: applied.typeFilter,
      dateStart: applied.dateStart,
      dateEnd: applied.dateEnd,
    });
  }, [applied.activeFilter, applied.clientFilter, applied.projectFilter, applied.sponsorFilter, applied.typeFilter, applied.dateStart, applied.dateEnd]);

  const activeScopedProjects = useMemo(() => {
    if (draft.activeFilter === "ativo") return allProjects.filter((p) => p.isActive);
    if (draft.activeFilter === "inativo") return allProjects.filter((p) => !p.isActive);
    return allProjects;
  }, [allProjects, draft.activeFilter]);

  const availableClients = useMemo(
    () => Array.from(new Set(activeScopedProjects.map((p) => p.client).filter(Boolean))).sort(),
    [activeScopedProjects]
  );

  const clientScopedProjects = useMemo(() => {
    if (draft.clientFilter === "todos") return activeScopedProjects;
    return activeScopedProjects.filter((p) => sameFilterValue(p.client, draft.clientFilter));
  }, [activeScopedProjects, draft.clientFilter]);

  const availableSponsors = useMemo(
    () => Array.from(new Set(clientScopedProjects.map((p) => p.sponsor || "Não informado"))).sort(),
    [clientScopedProjects]
  );

  const availableTypes = useMemo(
    () => Array.from(new Set(clientScopedProjects.map((p) => p.projectTypeDescription || p.projectType || "Não informado"))).sort(),
    [clientScopedProjects]
  );

  const projectScopedProjects = useMemo(() => clientScopedProjects.filter((project) => {
    if (draft.sponsorFilter !== "todos" && !sameFilterValue(project.sponsor || "Não informado", draft.sponsorFilter)) return false;
    if (draft.typeFilter !== "todos" && !sameFilterValue(project.projectTypeDescription || project.projectType || "Não informado", draft.typeFilter)) return false;
    return matchesProjectDateRange(project, draft.dateStart, draft.dateEnd);
  }), [clientScopedProjects, draft.sponsorFilter, draft.typeFilter, draft.dateStart, draft.dateEnd]);

  const setDraftValue = <K extends keyof GlobalFilterInput>(key: K, value: GlobalFilterInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setDependentDraftValue = <K extends keyof GlobalFilterInput>(key: K, value: GlobalFilterInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value, projectFilter: "todos" }));
  };

  const handleActiveChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      activeFilter: value,
      clientFilter: "todos",
      projectFilter: "todos",
      sponsorFilter: "todos",
      typeFilter: "todos",
    }));
  };

  const handleClientChange = (value: string) => {
    setDraft((current) => ({
      ...current,
      clientFilter: value,
      projectFilter: "todos",
      sponsorFilter: "todos",
      typeFilter: "todos",
      dateStart: "",
      dateEnd: "",
    }));
  };

  const handleProjectChange = (value: string) => {
    const selectedProject = clientScopedProjects.find((project) => String(project.id) === value || project.code === value);
    setDraft((current) => ({
      ...current,
      projectFilter: value,
      dateStart: selectedProject?.startDate && selectedProject.startDate !== "Sem data" ? selectedProject.startDate : current.dateStart,
      dateEnd: selectedProject ? currentDateIso() : current.dateEnd,
    }));
  };

  const handleClear = () => applied.clearFilters();
  const selectClass = "w-full h-8 px-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-md text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-[#0B3848]";
  const hasPendingChanges = draft.activeFilter !== applied.activeFilter
    || draft.clientFilter !== applied.clientFilter
    || draft.projectFilter !== applied.projectFilter
    || draft.sponsorFilter !== applied.sponsorFilter
    || draft.typeFilter !== applied.typeFilter
    || draft.dateStart !== applied.dateStart
    || draft.dateEnd !== applied.dateEnd;

  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#0B3848]/10 text-[#0B3848] flex items-center justify-center font-bold"><Filter className="w-4 h-4 text-[#0B3848]" /></div>
          <div><h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Filtros Globais da Gestão</h3><p className="text-[11px] text-slate-500">Selecione os critérios e clique em Filtrar para atualizar as abas e indicadores.</p></div>
        </div>
        <div className="flex items-center gap-2">
          {hasPendingChanges && <span className="hidden lg:inline text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1">Alterações pendentes — clique em Filtrar</span>}
          <Button size="sm" onClick={() => applied.applyFilters(draft)} className="h-8 text-xs gap-1.5 bg-[#0B3848] hover:bg-[#072530] text-white"><Search className="w-3.5 h-3.5" />Filtrar</Button>
          <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 text-xs text-slate-600 hover:text-[#0B3848] hover:bg-slate-100 gap-1.5"><RotateCcw className="w-3.5 h-3.5" />Limpar Filtros</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Projeto Ativo (S/N)</label><select value={draft.activeFilter} onChange={(e) => handleActiveChange(e.target.value)} className={selectClass}><option value="ativo">Sim (Ativo)</option><option value="inativo">Não (Inativo)</option><option value="todos">Todos</option></select></div>
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Cliente</label><select value={draft.clientFilter} onChange={(e) => handleClientChange(e.target.value)} className={selectClass}><option value="todos">Todos os clientes</option>{availableClients.map((client) => <option key={client} value={client}>{client}</option>)}</select></div>
        {showProjectSelector && <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Projeto</label><select value={draft.projectFilter} onChange={(e) => handleProjectChange(e.target.value)} className={selectClass}><option value="todos">Todos os projetos</option>{projectScopedProjects.map((p) => <option key={p.id} value={String(p.id)}>#{p.code} - {p.name.slice(0, 28)}</option>)}</select></div>}
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Gestor da Conta</label><select value={draft.sponsorFilter} onChange={(e) => setDependentDraftValue("sponsorFilter", e.target.value)} className={selectClass}><option value="todos">Todos os gestores</option>{availableSponsors.map((sponsor) => <option key={sponsor} value={sponsor}>{sponsor}</option>)}</select></div>
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Tipo de Projeto</label><select value={draft.typeFilter} onChange={(e) => setDependentDraftValue("typeFilter", e.target.value)} className={selectClass}><option value="todos">Todos os tipos</option>{availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Data Inicial</label><input lang="pt-BR" type="date" value={draft.dateStart} onChange={(e) => setDependentDraftValue("dateStart", e.target.value)} className={selectClass} /></div>
        <div><label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Data Final / Até</label><input lang="pt-BR" type="date" value={draft.dateEnd} onChange={(e) => setDependentDraftValue("dateEnd", e.target.value)} className={selectClass} /></div>
      </div>
    </div>
  );
}
