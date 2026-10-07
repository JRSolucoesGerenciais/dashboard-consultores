type HoursMetricProject = {
  hoursMetricsSource?: string | null;
  projectType?: string | null;
  projectTypeDescription?: string | null;
};

function isImplementationProject(project: HoursMetricProject | null | undefined) {
  const projectType = `${project?.projectTypeDescription || ""} ${project?.projectType || ""}`.toLowerCase();
  return projectType.includes("implant");
}

export function hasOfficialHoursMetrics(project: HoursMetricProject | null | undefined) {
  const source = String(project?.hoursMetricsSource || "").trim().toUpperCase();
  return source === "SQL_REV03_OFICIAL" || source === "SQL_REV03_AUTORITATIVA";
}

export function hasManagedHoursMetrics(project: HoursMetricProject | null | undefined) {
  const source = String(project?.hoursMetricsSource || "").trim().toUpperCase();
  return hasOfficialHoursMetrics(project)
    || source === "SQL_REV02_TRATADA_COM_REGRA_INTERNA"
    || source === "SQL_REV_ATUAL_PROGRAMADO_AJUSTADO"
    || (source === "SQL_REV02_TRATADA_NO_SISTEMA" && isImplementationProject(project));
}

export function hasManagedProductivityMetrics(project: (HoursMetricProject & { unproductiveActualHours?: unknown }) | null | undefined) {
  // Produtividade só é exibida quando a fonte entrega os dois campos oficiais.
  // Vínculo ao cronograma e regras internas não transformam realizado em produtivo.
  return hasOfficialHoursMetrics(project);
}
