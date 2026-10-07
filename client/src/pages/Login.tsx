import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a solicitação.");
  return data as { success: boolean; message?: string };
}

export default function Login() {
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        await postJson("/api/auth/login", { email, password });
        await utils.auth.me.invalidate();
        window.location.href = "/";
      } else {
        const result = await postJson("/api/auth/register", { name, email, password });
        toast.success(result.message ?? "Cadastro recebido.");
        setMode("login");
        setPassword("");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-[#0B3848]">CS Project Management</h1>
          <p className="text-xs text-slate-500">
            {mode === "login" ? "Entre com seu e-mail e senha." : "Solicite acesso. Um administrador precisa liberar seu cadastro."}
          </p>
        </div>
        {mode === "register" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 10 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" && <p className="text-[11px] text-slate-500">Mínimo de 10 caracteres.</p>}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Solicitar acesso"}
        </Button>
        <button
          type="button"
          className="w-full text-xs text-slate-500 hover:text-[#0B3848] underline"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Não tenho acesso — solicitar cadastro" : "Já tenho acesso — entrar"}
        </button>
      </form>
    </div>
  );
}
