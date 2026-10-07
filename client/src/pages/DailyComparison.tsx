import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

const AUTO = "auto";
const fmtHours = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSigned = (value: number) => `${value > 0 ? "+" : ""}${fmtHours(value)}`;
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

function Delta({ value, invertTone = false }: { value: number; invertTone?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="text-slate-400">—</span>;
  const good = invertTone ? value < 0 : value > 0;
  return <span className={good ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold"}>{fmtSigned(value)}</span>;
}

export default function DailyComparison() {
  const { isAdmin } = useAuth();
  const utils = trpc.useUtils();
  const [toDate, setToDate] = useState(AUTO);
  const [fromDate, setFromDate] = useState(AUTO);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const comparison = trpc.daily.compare.useQuery({
    toDate: toDate === AUTO ? undefined : toDate,
    fromDate: fromDate === AUTO ? undefined : fromDate,
  });
  const capture = trpc.daily.captureNow.useMutation({
    onSuccess: (result) => { toast.success(`Foto de ${fmtDate(result.snapshotDate)} gravada (${result.projects} projetos).`); utils.daily.invalidate(); },
    onError: (error) => toast.error(error.message),
  });

  const data = comparison.data;
  const rows = useMemo(() => (data?.projects ?? []).filter((p) => !onlyChanged || p.kind !== "sem_mudanca"), [data, onlyChanged]);
  const toggle = (id: number) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#0B3848]">Comparativo diário</h1>
          <p className="text-xs text-slate-500">
            Diferença entre duas fotos do portfólio, gravadas todo dia às 23h. Valores oficiais da API; níveis hierárquicos não são somados.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" disabled={capture.isPending} onClick={() => capture.mutate()}>
            {capture.isPending ? "Gravando..." : "Gravar foto agora"}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Dia</span>
          <Select value={toDate} onValueChange={setToDate}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Mais recente</SelectItem>
              {(data?.availableDates ?? []).map((d) => <SelectItem key={d} value={d}>{fmtDate(d)}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Comparar com</span>
          <Select value={fromDate} onValueChange={setFromDate}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Dia anterior</SelectItem>
              {(data?.availableDates ?? []).map((d) => <SelectItem key={d} value={d}>{fmtDate(d)}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          Somente projetos com mudança
        </label>
      </div>

      {comparison.isLoading && <div className="text-slate-500 text-sm">Carregando...</div>}

      {data && !data.toDate && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          Ainda não há nenhuma foto diária gravada. A primeira será criada na próxima rotina das 23h.
        </div>
      )}
      {data && data.toDate && !data.fromDate && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          Existe apenas a foto de {fmtDate(data.toDate)}. A comparação começa a partir da próxima rotina.
        </div>
      )}

      {data?.totals && data.fromDate && data.toDate && (
        <>
          <div className="text-xs text-slate-500">Comparando {fmtDate(data.fromDate)} → {fmtDate(data.toDate)}</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Horas apontadas", fmtSigned(data.totals.actualDelta) + " h"],
              ["Planejado alterado", fmtSigned(data.totals.plannedDelta) + " h"],
              ["Projetos com mudança", `${data.totals.changed} de ${data.totals.projects}`],
              ["Novos / removidos", `${data.totals.added} / ${data.totals.removed}`],
              ["Correções na origem", String(data.totals.corrections)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border border-slate-200 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{label}</div>
                <div className="text-lg font-bold text-[#0B3848]">{value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left p-3">Projeto</th>
                  <th className="text-right p-3">Realizado antes</th>
                  <th className="text-right p-3">Realizado agora</th>
                  <th className="text-right p-3">Apontado no dia</th>
                  <th className="text-right p-3">Planejado</th>
                  <th className="text-right p-3">% concl.</th>
                  <th className="text-left p-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => (
                  <Fragment key={project.projectId}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => project.modules.length > 0 && toggle(project.projectId)}>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">
                          {project.modules.length > 0 && <span className="text-slate-400 mr-1">{open.has(project.projectId) ? "▾" : "▸"}</span>}
                          #{project.projectCode} {project.projectName}
                        </div>
                        <div className="text-xs text-slate-500">{project.client}</div>
                      </td>
                      <td className="p-3 text-right tabular-nums">{fmtHours(project.actualFrom)}</td>
                      <td className="p-3 text-right tabular-nums">{fmtHours(project.actualTo)}</td>
                      <td className="p-3 text-right tabular-nums"><Delta value={project.actualDelta} /></td>
                      <td className="p-3 text-right tabular-nums"><Delta value={project.plannedDelta} invertTone /></td>
                      <td className="p-3 text-right tabular-nums"><Delta value={project.completionDelta} /></td>
                      <td className="p-3">
                        {project.kind === "novo" && <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">novo</Badge>}
                        {project.kind === "removido" && <Badge variant="outline" className="bg-slate-100 text-slate-600">removido</Badge>}
                        {project.actualDelta < -0.005 && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">correção</Badge>}
                        {project.statusChanged && <Badge variant="outline">{project.statusFrom} → {project.statusTo}</Badge>}
                      </td>
                    </tr>
                    {open.has(project.projectId) && project.modules.map((m) => (
                      <tr key={`${project.projectId}-${m.managementName}-${m.moduleName}`} className="bg-slate-50/70 text-xs">
                        <td className="py-2 pl-10 pr-3 text-slate-600">{m.managementName} · {m.moduleName}</td>
                        <td className="p-2 text-right tabular-nums">{fmtHours(m.actualFrom)}</td>
                        <td className="p-2 text-right tabular-nums">{fmtHours(m.actualTo)}</td>
                        <td className="p-2 text-right tabular-nums"><Delta value={m.actualDelta} /></td>
                        <td className="p-2 text-right tabular-nums"><Delta value={m.plannedDelta} invertTone /></td>
                        <td className="p-2 text-right tabular-nums"><Delta value={m.completionDelta} /></td>
                        <td className="p-2">{m.kind !== "alterado" ? m.kind : ""}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nenhum projeto com mudança entre as duas datas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
