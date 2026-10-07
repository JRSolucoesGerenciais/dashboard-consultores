# CS Project Management — instruções para Claude Code

## Objetivo

Finalizar e evoluir a aplicação web **CS Project Management / Gestão 360°**, em pt-BR, com visão gerencial baseada em PMBOK. O sistema é uma camada de acompanhamento e gestão; os dados operacionais oficiais vêm da API SQL do CSAgenda.

## Antes de editar

1. Leia `TRANSFER_README.md`, `todo.md`, `api-reset-spec-20261005.md`, `auditoria-rev07-20261005.md` e os documentos de `docs/external/`.
2. Execute `pnpm install` e confirme `pnpm check`.
3. Não reconstrua a aplicação nem substitua a navegação existente. Preserve o layout, o TopNav, os filtros globais, o fluxo de importação incremental e a integração CSAgenda.
4. Não use credenciais reais no código. Copie `.env.example` para `.env` e preencha os valores apenas no ambiente local/seguro.

## Regras de dados obrigatórias — Rev07

- A API/SQL Rev07 é a fonte oficial.
- A interface consulta, filtra, organiza e apresenta; não inventa planejamento, realizado, produtividade ou regras de hierarquia.
- **Nunca some N1 + N2 + N3 + N4.** N1/N2/N3/N4 são camadas da mesma hierarquia; podem existir apontamentos em qualquer nível.
- Para Gestão/Módulo, prefira os resumos oficiais: `RESUMO_MODULO_*` e `RESUMO_GESTAO_*`; em compatibilidade, use `HORAS_MODULO_*`/`HORAS_REALIZADAS_MODULO_*`.
- Para a árvore PPSA, diferencie `HORAS_REALIZADAS_ATOMICAS_DECIMAL` de `HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL`.
- `HORAS_TOTAL` é o realizado consolidado da linha/PPSA e não é o total do módulo.
- Nunca derive horas produtivas/improdutivas se a API não fornecer o indicador oficial.
- Não reintroduza conversão API→XLSX nem processamento HTTP longo. O staging incremental deve permanecer.
- Campos HTML da API são opcionais/apresentacionais e não devem ser requisito estrutural.

## Áreas principais

- `client/src/pages/Home.tsx`: Portfólio, KPIs, saúde, projetos críticos, resumo único Gestão/Módulo, tendência histórica e alertas.
- `client/src/pages/ProjectDetail.tsx`: resumo oficial do projeto, cards de horas, decomposição de cronograma, árvore PPSA e milestones.
- `client/src/pages/VisualControl.tsx`: Cronograma Semanal — Projeto, abas de atividades, módulos, Gantt e PPSA.
- `client/src/pages/WeeklyCheckin.tsx`: check-ins semanais e evolução física informada.
- `client/src/pages/RisksManagement.tsx`: riscos, problemas e decisões.
- `client/src/pages/SpreadsheetUploadPage.tsx` e `client/src/components/OracleApiIntegrationSection.tsx`: importação XLSX/API, prévia, staging e publicação.
- `server/oracleSyncService.ts`: conexão, prévia, staging e publicação da API CSAgenda.
- `server/spreadsheetService.ts`: detector/parser/importador e aliases oficiais da Rev07.
- `server/ppsahours.ts` e `shared/hierarchyHours.ts`: consolidação PPSA sem duplicidade hierárquica.
- `server/routers.ts` e `server/db.ts`: contratos tRPC e acesso ao banco.
- `drizzle/schema.ts` e `drizzle/*.sql`: schema e migrações.

## Fluxo de desenvolvimento

```bash
pnpm install
cp .env.example .env
# preencher as variáveis do ambiente
pnpm check
pnpm test
pnpm build
pnpm dev
```

Para mudança de schema:

```bash
pnpm drizzle-kit generate
# revisar o SQL gerado
# aplicar a migração no banco apropriado antes de testar a aplicação
```

## Critérios antes de declarar uma tarefa concluída

- `pnpm check` sem erros.
- `pnpm test` sem testes ignorados ou expectativas alteradas apenas para esconder duplicidade.
- `pnpm build` concluído.
- `git diff --check` sem erros.
- Validar visualmente `/`, `/projeto/122`, `/projeto/200`, `/controle-visual` e `/atualizar-planilha` quando a alteração afetar essas telas.
- Auditar valores diretamente contra a resposta atual da API; não usar valores históricos tratados como verdade.
- Documentar limitações temporais: apontamentos sem data explícita não podem ser distribuídos artificialmente nas últimas semanas.
