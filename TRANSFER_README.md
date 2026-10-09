# CS Project Management — pacote para Claude Code

## O que este pacote contém

Este pacote é uma cópia do código-fonte do projeto no commit `d01ceb3` (`main`), acrescida de documentação de continuidade, especificações SQL/API utilizadas no trabalho e o fixture local que faltava para dois testes de importação.

Inclui:

- frontend React 19 + Vite + TypeScript + Tailwind/shadcn;
- backend Express + tRPC 11;
- Drizzle ORM (originalmente MySQL/TiDB; agora PostgreSQL/Supabase, ver docs/SETUP_PRODUCAO.md);
- autenticação Manus OAuth já integrada;
- filtros globais de portfólio;
- Portfólio Geral com KPIs, saúde PMBOK, riscos, tendência e resumo Gestão/Módulo;
- Projeto Detalhado com árvore PPSA, horas oficiais, cronograma, marcos, check-ins e Curva S;
- Cronograma Semanal — Projeto;
- Check-in Semanal;
- Riscos & Decisões;
- importação por planilha e integração CSAgenda via API, com prévia, staging incremental e publicação;
- schema Drizzle, todas as migrações, testes e documentos de auditoria.

## O que não está incluído por segurança

- `.env`, tokens, chaves, cookies, senhas ou credenciais;
- `node_modules/`;
- `dist/`, logs de execução e caches locais;
- dump do banco de dados de produção.

O banco existente não é transferido pelo ZIP. É necessário configurar uma `DATABASE_URL` com acesso ao banco correto e aplicar/revisar as migrações antes de executar a aplicação em outro ambiente.

## Instalação rápida

Requisitos recomendados:

- Node.js 22+
- pnpm 10+
- PostgreSQL (Supabase)

```bash
pnpm install
cp .env.example .env
# preencher .env com valores do novo ambiente
pnpm check
pnpm test
pnpm build
pnpm dev
```

A aplicação local fica em `http://localhost:3000`.

## Variáveis de ambiente

Consulte `.env.example` e `server/_core/env.ts`. As principais são:

- `DATABASE_URL`: banco MySQL/TiDB;
- `JWT_SECRET`: segredo de sessão;
- `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`: OAuth;
- `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`: serviços Manus, se usados no ambiente;
- `PROJECT_IMPORT_API_KEY`: proteção opcional da rota de importação externa;
- `ORACLE_API_TOKEN`: token opcional da integração CSAgenda/API.

Nunca coloque esses valores no Git ou envie-os no chat.

## Banco e migrações

O schema está em `drizzle/schema.ts`. As migrações ordenadas estão em `drizzle/*.sql`, com snapshots em `drizzle/meta/`. A migração mais recente é `0026_bright_mikhail_rasputin.sql`, que adiciona os resumos oficiais Rev07 de módulo e gestão.

A aplicação histórica deste projeto usou o fluxo WebDev para aplicar migrações no banco gerenciado. No Claude Code, revise o banco de destino e aplique as migrações de forma controlada; não execute migrações destrutivas automaticamente.

## Rotas principais

| Rota | Função |
|---|---|
| `/` | Portfólio Geral / dashboard executivo |
| `/projeto` | Projeto selecionado / detalhe |
| `/projeto/:id` | Detalhe de um projeto |
| `/controle-visual` | Cronograma Semanal — Projeto |
| `/controle-visual/:id` | Cronograma de um projeto |
| `/apontamento-semanal` | Check-in Semanal |
| `/riscos-problemas` | Riscos, problemas e decisões |
| `/atualizar-planilha` | Importação de planilha e API CSAgenda |

## API CSAgenda e Rev07

A integração trabalha com a consulta `consulta=2` do endpoint CSAgenda. As especificações e auditorias fornecidas pelo usuário estão em `docs/external/` e na raiz do projeto.

Os aliases oficiais de referência são:

- módulo: `RESUMO_MODULO_HORAS_PLANEJADAS_DECIMAL`, `RESUMO_MODULO_HORAS_REALIZADAS_DECIMAL`, `RESUMO_MODULO_PERCENTUAL_REALIZADO`;
- gestão: `RESUMO_GESTAO_HORAS_PLANEJADAS_DECIMAL`, `RESUMO_GESTAO_HORAS_REALIZADAS_DECIMAL`, `RESUMO_GESTAO_PERCENTUAL_REALIZADO`;
- árvore: `HORAS_ATIVIDADE_PLANEJADAS_DECIMAL`, `HORAS_REALIZADAS_ATOMICAS_DECIMAL`, `HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL`, `ID_PAI_PPSA`, `TIPO_REGISTRO`, `POSSUI_CRONOGRAMA`.

Não publique uma nova carga antes de conferir o contrato e a resposta real da API. O primeiro chunk pode não conter todas as colunas; o contrato persistido da prévia deve ser usado.

## Fixture dos testes

O arquivo `test-fixtures/ResumoGeraldosProjetos.xls` foi incluído para tornar reprodutíveis os testes que historicamente procuravam `/home/ubuntu/compare_xls/ResumoGeraldosProjetos.xlsx`. A cópia do teste no pacote usa o fixture local.

## Estado do projeto no momento da transferência

O último checkpoint implementou o resumo único `Resumo por Gestão / Módulo` no dashboard:

- removeu os dois cartões separados de evolução e módulos com atenção;
- ordena por código oficial de Gestão e Módulo;
- permite escolher uma Gestão para análise;
- não repete o nome do projeto no quadro, pois o projeto é definido pelo filtro global;
- mantém os valores oficiais da API e a regra de não somar níveis hierárquicos.

Pendências e histórico detalhado continuam em `todo.md` e nos relatórios de auditoria.

## Próximo roteiro recomendado para Claude Code

1. Rodar a suíte completa e revisar qualquer falha de ambiente.
2. Iniciar a aplicação com dados de teste e navegar por todas as rotas principais.
3. Conferir os projetos de referência `122` e `200` contra uma resposta atual da API, separando planejado, realizado consolidado, resumo de módulo e resumo de gestão.
4. Revisar as pendências restantes em `todo.md` sem alterar as regras Rev07.
5. Criar testes de integração/visual para o filtro global e o resumo Gestão/Módulo.
6. Só depois preparar deploy/publicação no ambiente escolhido.
