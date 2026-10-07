import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/_core/hooks/useAuth";
import { ProfileRole, useProfile } from "@/contexts/ProfileContext";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  GitCompareArrows,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Grid3X3,
  Layers,
  LogOut,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from "lucide-react";
import { Link, useLocation } from "wouter";

export function TopNav() {
  const { currentProfile, setCurrentProfile, profileNames } = useProfile();
  const [location] = useLocation();
  const { user, isAdmin, logout } = useAuth();

  const getProfileIcon = (role: ProfileRole) => {
    switch (role) {
      case "diretoria":
        return <Building2 className="w-4 h-4 text-purple-600" />;
      case "pmo":
        return <ShieldCheck className="w-4 h-4 text-[#0B3848]" />;
      case "gerente":
        return <UserCheck className="w-4 h-4 text-emerald-600" />;
      case "consultor":
        return <Users className="w-4 h-4 text-amber-600" />;
      case "cliente":
        return <CheckCircle2 className="w-4 h-4 text-cyan-600" />;
    }
  };

  const navClass = (path: string, exact = false) => {
    const active = exact ? location === path : location.startsWith(path);
    return `px-3 py-2 rounded-md transition flex items-center gap-2 text-xs font-semibold ${
      active
        ? "bg-[#0B3848]/10 text-[#0B3848] border-b-2 border-[#CF142B] shadow-2xs"
        : "text-slate-600 hover:text-[#0B3848] hover:bg-slate-100/70"
    }`;
  };

  return (
    <header className="border-b bg-white sticky top-0 z-40 shadow-xs">
      <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Identidade CS Compusoftware Oficial */}
        <div className="flex items-center space-x-6">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="h-11 px-2.5 py-1 rounded-lg bg-white border border-slate-200 shadow-2xs flex items-center justify-center transition group-hover:border-[#CF142B]/40">
              <img
                src="/manus-storage/cs-compusoftware-logo_5f5a1f82.jpg"
                alt="CS CompuSoftware - Inteligência e produtividade"
                className="h-8 w-auto object-contain max-w-[170px]"
              />
            </div>
            <div className="hidden lg:block">
              <div className="font-bold text-[#0B3848] leading-tight flex items-center gap-1.5 text-sm">
                Gestão 360°
                <span className="text-[10px] bg-[#FDE8EA] text-[#CF142B] font-bold px-2 py-0.2 rounded-full border border-[#CF142B]/30">
                  PMBOK 8ª Ed.
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-medium">Inteligência e produtividade em projetos</div>
            </div>
          </Link>

          {/* Links Principais */}
          <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
            <Link href="/" className={navClass("/", true)}>
              <BarChart3 className="w-4 h-4" />
              Portfólio Geral
            </Link>
            <Link href="/projeto" className={navClass("/projeto")}>
              <Layers className="w-4 h-4" />
              Projeto Detalhado
            </Link>
            <Link href="/controle-visual" className={navClass("/controle-visual")}>
              <Grid3X3 className="w-4 h-4" />
              Cronograma Semanal - Projeto
            </Link>
            <Link href="/apontamento-semanal" className={navClass("/apontamento-semanal", true)}>
              <CalendarDays className="w-4 h-4" />
              Check-in Semanal
            </Link>
            <Link href="/comparativo-diario" className={navClass("/comparativo-diario", true)}>
              <GitCompareArrows className="w-4 h-4" />
              Comparativo Diário
            </Link>
            <Link href="/riscos-problemas" className={navClass("/riscos-problemas", true)}>
              <AlertTriangle className="w-4 h-4" />
              Riscos & Decisões
            </Link>
            {isAdmin && (
              <Link href="/atualizar-planilha" className={navClass("/atualizar-planilha", true)}>
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Atualizar Planilha
              </Link>
            )}
            {isAdmin && (
              <Link href="/admin/usuarios" className={navClass("/admin/usuarios", true)}>
                <UserCog className="w-4 h-4" />
                Usuários
              </Link>
            )}
          </nav>
        </div>

        {/* Alternador de Perfil em Tempo Real */}
        <div className="flex items-center space-x-3">
          {user && (
            <div className="hidden md:block text-right">
              <div className="text-xs font-bold text-[#0B3848]">{user.name}</div>
              <div className="text-[10px] text-slate-400">{isAdmin ? "Administrador" : user.profileRole === "cliente" ? "Cliente" : "Coordenador de projetos"}</div>
            </div>
          )}
          {user && (
            <Button variant="outline" size="sm" onClick={() => logout()} className="flex items-center gap-1">
              <LogOut className="w-3.5 h-3.5" />
              <span className="text-xs">Sair</span>
            </Button>
          )}
          {isAdmin && (<>
          <div className="hidden sm:block text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Perfil Ativo</div>
            <div className="text-xs font-bold text-[#0B3848] flex items-center gap-1 justify-end">
              {getProfileIcon(currentProfile)}
              {profileNames[currentProfile]}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-2 border-slate-300 hover:border-[#CF142B]/40 hover:bg-[#FDE8EA]/30">
                <span className="font-semibold text-xs text-[#0B3848]">Trocar Perfil</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-slate-500">Selecione o Papel</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(profileNames) as ProfileRole[]).map((role) => (
                <DropdownMenuItem
                  key={role}
                  onClick={() => setCurrentProfile(role)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    {getProfileIcon(role)}
                    <span className="text-xs font-medium text-slate-700">{profileNames[role]}</span>
                  </div>
                  {currentProfile === role && (
                    <Badge variant="secondary" className="text-[10px] bg-[#FDE8EA] text-[#CF142B] font-bold border border-[#CF142B]/30">
                      Ativo
                    </Badge>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          </>)}
        </div>
      </div>
    </header>
  );
}
