

## Hierarquia final da API — 05/10/2026 15:40 BRT

- [x] SQL final auditada: N1 = total Projeto/Gestão/Módulo; N2 = total do Processo; N3/N4 = apontamentos e descendentes; a soma de níveis é proibida.
- [x] Criado helper compartilhado `shared/hierarchyHours.ts` para selecionar o nível mais alto e deduplicar N1 por Gestão/Módulo; níveis inferiores usam PPSA + nível.
- [x] Corrigido `consolidatePpsaRows` e `buildManagementModuleSummary`; o módulo Gestão 30/Implantação do #122 passou de 45,00 h repetidas para 22,50 h.
- [x] Aplicado o mesmo helper em Projeto Detalhado, Cronograma Semanal, tendência, Curva S, resumo de horas e métricas do Portfólio.
- [x] Planejamento do resumo usa `HORAS_MODULO_PLANEJADAS` por módulo quando disponível, evitando somar `TOTAL_HORA_DIAS_PROGRAMADOS` de níveis repetidos.
- [x] Republicação controlada concluída: lote `1170001`, 812 linhas, projetos 122 e 200.
- [x] Totais ativos após a republicação: #122 = 6.960,00 h planejadas / 1.374,45 h realizadas; #200 = 18.160,00 h planejadas / 4.053,06 h realizadas.
- [x] A resposta atual acessível da API para #200 traz 435 linhas e N1/módulo = 4.053,07 h; o valor de 10.935,2 h informado em outro teste não está presente nessa resposta e não foi fabricado no sistema.
- [x] `pnpm check`, `pnpm test` (37 testes), `pnpm build` e `git diff --check` aprovados.

## Recomeço oficial da integração — 05/10/2026 16:15 BRT

- [x] Limpeza de tratamentos provisórios realizada sem alterar o layout nem o fluxo de importação.
- [x] Nova especificação versionada em `api-reset-spec-20261005.md`.
- [x] Coluna `moduleActualHours` adicionada e migrada via `drizzle/0024_conscious_jack_flag.sql`.
- [x] Contrato da API atualizado para exigir `HORAS_REALIZADAS_MODULO` e `HORAS_MODULO_PLANEJADAS`.
- [x] Publicação de novas cargas com shape RevAtual bloqueada automaticamente caso os campos de realizado oficial por módulo não estejam presentes.
- [x] Suíte completa de testes aprovada: 37 testes em 4 arquivos (`pnpm check` e `pnpm test`).
