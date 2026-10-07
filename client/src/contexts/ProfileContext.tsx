import React, { createContext, useContext, useState } from "react";

export type ProfileRole = "diretoria" | "pmo" | "gerente" | "consultor" | "cliente";

interface ProfileContextType {
  currentProfile: ProfileRole;
  setCurrentProfile: (role: ProfileRole) => void;
  profileNames: Record<ProfileRole, string>;
  profileDescriptions: Record<ProfileRole, string>;
}

const profileNames: Record<ProfileRole, string> = {
  diretoria: "Diretoria Executiva",
  pmo: "PMO / Escritório de Projetos",
  gerente: "Gerente de Projetos",
  consultor: "Consultor Técnico",
  cliente: "Cliente / Sponsor",
};

const profileDescriptions: Record<ProfileRole, string> = {
  diretoria: "Visão estratégica macro: RAG, desvios financeiros e de prazo, portfólio consolidado.",
  pmo: "Governança PMBOK: aderência aos ritos, SPI/CPI, qualidade de dados e fila de riscos críticos.",
  gerente: "Gestão operacional e gerencial: evolução semanal, controle de módulos, alocação e riscos.",
  consultor: "Visão focada na esteira de atividades: módulo, presença/remoto, horas apontadas e gargalos.",
  cliente: "Transparência executiva: marcos entregues, próximos passos e decisões sob responsabilidade do cliente.",
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [currentProfile, setCurrentProfile] = useState<ProfileRole>("gerente");

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        setCurrentProfile,
        profileNames,
        profileDescriptions,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile deve ser usado dentro de um ProfileProvider");
  }
  return context;
}
