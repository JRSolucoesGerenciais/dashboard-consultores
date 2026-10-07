import React, { createContext, useContext, useMemo, useState } from "react";

export interface GlobalFilterState {
  activeFilter: string;
  clientFilter: string;
  projectFilter: string;
  sponsorFilter: string;
  typeFilter: string;
  dateStart: string;
  dateEnd: string;
  search: string;
  selectedProjectId: number | null;
}

export interface GlobalFilterInput {
  activeFilter: string;
  clientFilter: string;
  projectFilter: string;
  sponsorFilter: string;
  typeFilter: string;
  dateStart: string;
  dateEnd: string;
}

export function normalizeFilterValue(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

export function sameFilterValue(left: unknown, right: unknown) {
  return normalizeFilterValue(left) === normalizeFilterValue(right);
}

export function currentDateIso() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function matchesProjectDateRange(
  project: { startDate?: string | null; plannedEndDate?: string | null },
  dateStart: string,
  dateEnd: string,
) {
  const projectStart = project.startDate && project.startDate !== "Sem data" ? project.startDate : null;
  const projectEnd = project.plannedEndDate && project.plannedEndDate !== "Sem data" ? project.plannedEndDate : null;
  if (dateStart && projectEnd && projectEnd < dateStart) return false;
  if (dateEnd && projectStart && projectStart > dateEnd) return false;
  return true;
}

interface GlobalFilterContextType extends GlobalFilterState {
  setActiveFilter: (val: string) => void;
  setClientFilter: (val: string) => void;
  setProjectFilter: (val: string) => void;
  setSponsorFilter: (val: string) => void;
  setTypeFilter: (val: string) => void;
  setDateStart: (val: string) => void;
  setDateEnd: (val: string) => void;
  setSearch: (val: string) => void;
  setSelectedProjectId: (val: number | null) => void;
  applyFilters: (filters: GlobalFilterInput) => void;
  clearFilters: () => void;
}

const DEFAULT_FILTERS: GlobalFilterInput = {
  activeFilter: "ativo",
  clientFilter: "todos",
  projectFilter: "todos",
  sponsorFilter: "todos",
  typeFilter: "todos",
  dateStart: "",
  dateEnd: "",
};

const GlobalFilterContext = createContext<GlobalFilterContextType | undefined>(undefined);

export function GlobalFilterProvider({ children }: { children: React.ReactNode }) {
  const [activeFilter, setActiveFilterState] = useState(DEFAULT_FILTERS.activeFilter);
  const [clientFilter, setClientFilterState] = useState(DEFAULT_FILTERS.clientFilter);
  const [projectFilter, setProjectFilterState] = useState(DEFAULT_FILTERS.projectFilter);
  const [sponsorFilter, setSponsorFilterState] = useState(DEFAULT_FILTERS.sponsorFilter);
  const [typeFilter, setTypeFilterState] = useState(DEFAULT_FILTERS.typeFilter);
  const [dateStart, setDateStartState] = useState(DEFAULT_FILTERS.dateStart);
  const [dateEnd, setDateEndState] = useState(DEFAULT_FILTERS.dateEnd);
  const [search, setSearchState] = useState("");
  const [selectedProjectId, setSelectedProjectIdState] = useState<number | null>(null);

  const setActiveFilter = (val: string) => setActiveFilterState(val);
  const setClientFilter = (val: string) => setClientFilterState(val);
  const setProjectFilter = (val: string) => {
    setProjectFilterState(val);
    if (val === "todos") {
      setSelectedProjectIdState(null);
      return;
    }
    const numericProjectId = Number(val);
    if (Number.isFinite(numericProjectId)) setSelectedProjectIdState(numericProjectId);
  };
  const setSponsorFilter = (val: string) => setSponsorFilterState(val);
  const setTypeFilter = (val: string) => setTypeFilterState(val);
  const setDateStart = (val: string) => setDateStartState(val);
  const setDateEnd = (val: string) => setDateEndState(val);

  const applyFilters = (filters: GlobalFilterInput) => {
    setActiveFilterState(filters.activeFilter);
    setClientFilterState(filters.clientFilter);
    setProjectFilterState(filters.projectFilter);
    setSponsorFilterState(filters.sponsorFilter);
    setTypeFilterState(filters.typeFilter);
    setDateStartState(filters.dateStart);
    setDateEndState(filters.dateEnd);
    if (filters.projectFilter === "todos") setSelectedProjectIdState(null);
    else {
      const numericProjectId = Number(filters.projectFilter);
      if (Number.isFinite(numericProjectId)) setSelectedProjectIdState(numericProjectId);
    }
  };

  const clearFilters = () => {
    applyFilters(DEFAULT_FILTERS);
    setSearchState("");
  };

  const value = useMemo(
    () => ({
      activeFilter,
      clientFilter,
      projectFilter,
      sponsorFilter,
      typeFilter,
      dateStart,
      dateEnd,
      search,
      selectedProjectId,
      setActiveFilter,
      setClientFilter,
      setProjectFilter,
      setSponsorFilter,
      setTypeFilter,
      setDateStart,
      setDateEnd,
      setSearch: setSearchState,
      setSelectedProjectId: setSelectedProjectIdState,
      applyFilters,
      clearFilters,
    }),
    [activeFilter, clientFilter, projectFilter, sponsorFilter, typeFilter, dateStart, dateEnd, search, selectedProjectId]
  );

  return <GlobalFilterContext.Provider value={value}>{children}</GlobalFilterContext.Provider>;
}

export function useGlobalFilters() {
  const ctx = useContext(GlobalFilterContext);
  if (!ctx) throw new Error("useGlobalFilters deve ser usado dentro de GlobalFilterProvider");
  return ctx;
}
