import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Level = "admin" | "coordenador" | "cliente";
type UserRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: "admin" | "user";
  profileRole: string;
  status: "pendente" | "ativo" | "bloqueado";
  projectIds: number[];
};

const levelOf = (user: Pick<UserRow, "role" | "profileRole">): Level =>
  user.role === "admin" ? "admin" : user.profileRole === "cliente" ? "cliente" : "coordenador";

const LEVEL_LABEL: Record<Level, string> = { admin: "Administrador", coordenador: "Coordenador de projetos", cliente: "Cliente" };
const STATUS_STYLE = {
  ativo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pendente: "bg-amber-50 text-amber-700 border-amber-200",
  bloqueado: "bg-red-50 text-red-700 border-red-200",
} as const;

export default function AdminUsers() {
  const utils = trpc.useUtils();
  const users = trpc.admin.listUsers.useQuery();
  const projects = trpc.projects.list.useQuery();
  const onError = (error: { message: string }) => toast.error(error.message);
  const refresh = () => utils.admin.listUsers.invalidate();

  const updateUser = trpc.admin.updateUser.useMutation({ onSuccess: refresh, onError });
  const setProjectsMutation = trpc.admin.setUserProjects.useMutation({
    onSuccess: () => { toast.success("Projetos atualizados."); refresh(); setEditing(null); },
    onError,
  });
  const resetPassword = trpc.admin.resetPassword.useMutation({
    onSuccess: () => { toast.success("Senha redefinida."); setResetting(null); setNewPassword(""); },
    onError,
  });
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: () => { toast.success("Usuário criado."); setCreating(false); setForm(emptyForm); refresh(); },
    onError,
  });

  const [editing, setEditing] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const emptyForm = { name: "", email: "", password: "", level: "cliente" as Level };
  const [form, setForm] = useState(emptyForm);

  const visibleProjects = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (projects.data ?? []).filter((p) => !term || `${p.code} ${p.name} ${p.client}`.toLowerCase().includes(term));
  }, [projects.data, filter]);

  const changeLevel = (user: UserRow, level: Level) =>
    updateUser.mutate({ id: user.id, role: level === "admin" ? "admin" : "user", ...(level === "admin" ? {} : { profileRole: level }) });

  const pendingCount = (users.data ?? []).filter((u) => u.status === "pendente").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#0B3848]">Usuários e acessos</h1>
          <p className="text-xs text-slate-500">
            Libere cadastros, defina o perfil e escolha quais projetos cada coordenador ou cliente pode ver.
            {pendingCount > 0 && <span className="ml-2 font-semibold text-amber-700">{pendingCount} aguardando liberação</span>}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>Novo usuário</Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left p-3">Usuário</th>
              <th className="text-left p-3">Perfil</th>
              <th className="text-left p-3">Situação</th>
              <th className="text-left p-3">Projetos</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((user) => {
              const level = levelOf(user);
              return (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="p-3">
                    <div className="font-semibold text-slate-800">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="p-3 w-56">
                    <Select value={level} onValueChange={(value) => changeLevel(user, value as Level)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(LEVEL_LABEL) as Level[]).map((key) => (
                          <SelectItem key={key} value={key}>{LEVEL_LABEL[key]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={STATUS_STYLE[user.status]}>{user.status}</Badge>
                  </td>
                  <td className="p-3 text-xs text-slate-600">
                    {level === "admin" ? "Todos" : `${user.projectIds.length} projeto(s)`}
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    {level !== "admin" && (
                      <Button size="sm" variant="outline" onClick={() => { setEditing(user); setSelected(new Set(user.projectIds)); setFilter(""); }}>
                        Projetos
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setResetting(user)}>Senha</Button>
                    {user.status !== "ativo" ? (
                      <Button size="sm" onClick={() => updateUser.mutate({ id: user.id, status: "ativo" })}>Liberar</Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => updateUser.mutate({ id: user.id, status: "bloqueado" })}>Bloquear</Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.data?.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Nenhum usuário cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Projetos de {editing?.name}</DialogTitle></DialogHeader>
          <Input placeholder="Filtrar por código, nome ou cliente" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {visibleProjects.map((project) => (
              <label key={project.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.has(project.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(project.id); else next.delete(project.id);
                    setSelected(next);
                  }}
                />
                <span className="font-mono text-xs text-slate-500">{project.code}</span>
                <span className="truncate">{project.name}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">{selected.size} selecionado(s)</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={setProjectsMutation.isPending} onClick={() => editing && setProjectsMutation.mutate({ userId: editing.id, projectIds: Array.from(selected) })}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetting} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Redefinir senha de {resetting?.name}</DialogTitle></DialogHeader>
          <Label htmlFor="np">Nova senha (mínimo 10 caracteres)</Label>
          <Input id="np" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)}>Cancelar</Button>
            <Button disabled={newPassword.length < 10 || resetPassword.isPending} onClick={() => resetting && resetPassword.mutate({ id: resetting.id, password: newPassword })}>
              Redefinir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Senha inicial (mínimo 10 caracteres)</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
            <div>
              <Label>Perfil</Label>
              <Select value={form.level} onValueChange={(value) => setForm({ ...form, level: value as Level })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LEVEL_LABEL) as Level[]).map((key) => <SelectItem key={key} value={key}>{LEVEL_LABEL[key]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 mt-1">Os projetos liberados são escolhidos depois, em “Projetos”.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button
              disabled={createUser.isPending || !form.name || !form.email || form.password.length < 10}
              onClick={() => createUser.mutate({
                name: form.name, email: form.email, password: form.password,
                role: form.level === "admin" ? "admin" : "user",
                profileRole: form.level === "cliente" ? "cliente" : "coordenador",
              })}
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
