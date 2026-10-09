# Colocando o sistema no ar (fora do Manus)

## 1. Banco de dados (Supabase)

O sistema usa **PostgreSQL**; o Supabase serve como banco gerenciado. Usamos só o Postgres dele: o login é o próprio da aplicação (não o Supabase Auth) e a aplicação acessa o banco pelo servidor, nunca pelo navegador.

1. Em supabase.com, crie um projeto (região South America/São Paulo) e guarde a senha do banco.
2. Em *Connect* (ou *Settings → Database → Connection string*), copie duas URLs:
   - **Transaction pooler** (porta 6543) → `DATABASE_URL`. É a que a aplicação e a rotina das 23h usam. Funciona em IPv4, necessário para o GitHub Actions.
   - **Session pooler** (porta 5432 do mesmo host) → `MIGRATE_DATABASE_URL`, só para aplicar migrações.
3. A conexão direta (`db.PROJETO.supabase.co`) é só IPv6 no plano gratuito; evite.

**Segurança:** todas as tabelas são criadas com RLS ligado e sem políticas. Assim, a API pública do Supabase (chave `anon`) não lê nada; só o servidor, conectado com a senha do banco, acessa os dados. Nunca coloque a `DATABASE_URL` no navegador nem no Git.

Os dados antigos do Manus **não** vêm junto: o banco nasce vazio e se enche na primeira sincronização com a API CSAgenda. Cadastros feitos só no Manus (check-ins semanais, riscos, snapshots de Curva S) precisam ser exportados de lá, se ainda forem necessários.

## 2. Preparar o banco e o primeiro administrador

```bash
cp .env.example .env        # preencher DATABASE_URL, MIGRATE_DATABASE_URL e JWT_SECRET (openssl rand -hex 32)
pnpm install
pnpm db:migrate             # cria as tabelas (migração 0000 do Postgres)
ADMIN_EMAIL=voce@empresa.com ADMIN_NAME="Seu Nome" ADMIN_PASSWORD='senha-longa' pnpm admin:create
```

Para desenvolver sem servidor: `DATABASE_URL=pglite://./.data/dev` usa um Postgres embutido, com migrações aplicadas sozinhas. As migrações antigas de MySQL ficam arquivadas em `docs/legacy-mysql/`.

## 3. Perfis de acesso

| Perfil | O que vê | O que faz |
|---|---|---|
| Administrador | Todos os projetos | Tudo: usuários, importações, API CSAgenda, rollback |
| Coordenador de projetos | Só os projetos liberados | Consulta, check-in semanal, riscos |
| Cliente | Só os projetos liberados | Somente leitura |

- Novos cadastros (tela de login → "solicitar cadastro") entram **pendentes**; o administrador libera em **Usuários**, define o perfil e marca os projetos.
- O seletor "Trocar Perfil" do topo é só uma visão de tela, restrito ao administrador. A segurança é feita no servidor.

## 4. Atualização diária às 23h e comparação dia a dia

A rotina `pnpm sync:daily` (arquivo `scripts/daily-sync.ts`):

1. consulta a API CSAgenda e monta a prévia;
2. publica a carga e espera terminar;
3. grava a **foto do dia** (`daily_project_snapshots` e `daily_module_snapshots`);
4. compara com a foto anterior e imprime o resumo.

As horas apontadas em um dia = realizado de hoje − realizado da foto anterior (por projeto e por Gestão/Módulo, valores oficiais, sem somar N1–N4). A tela **Comparativo Diário** permite escolher quaisquer duas datas. Se um dia falhar, a comparação usa a foto anterior disponível.

**Agendamento (recomendado: GitHub Actions)** — `.github/workflows/daily-sync.yml` roda às 02:00 UTC = 23:00 de Brasília.

1. No GitHub: *Settings → Secrets and variables → Actions* e crie `DATABASE_URL` e `ORACLE_API_TOKEN`.
2. Teste uma vez em *Actions → Sincronização diária → Run workflow*.
3. Observações: o GitHub pode atrasar o disparo em alguns minutos e desativa agendamentos de repositórios públicos sem atividade por 60 dias.

Na tela **Atualizar planilha**, salve o endereço da API CSAgenda e mantenha a sincronização periódica em segundo plano **desligada** (ela concorre com a rotina das 23h).

## 5. Hospedar a aplicação web

`pnpm build && pnpm start` (porta `PORT`, padrão 3000). Opções: Railway, Render, Fly.io ou uma VPS, sempre atrás de HTTPS (o cookie de sessão é `secure`). Variáveis: `DATABASE_URL` (pooler 6543), `JWT_SECRET`, `ORACLE_API_TOKEN`, `NODE_ENV=production`.

## 6. Pontos conhecidos

- **Anexos de check-in** ainda usam o armazenamento do Manus (`BUILT_IN_FORGE_*`). Sem essas variáveis, o envio de anexo falha; o restante funciona. Migrar para S3 compatível é um próximo passo.
- Fotos diárias começam a existir a partir da primeira execução; não há histórico retroativo.
- Limite de tentativas de login é em memória (reinicia com o servidor); com várias instâncias, mover para o banco/Redis.
