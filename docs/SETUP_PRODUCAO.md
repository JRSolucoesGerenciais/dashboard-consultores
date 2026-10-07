# Colocando o sistema no ar (fora do Manus)

## 1. Banco de dados

O Manus mantinha o banco dentro da plataforma, sem dump exportável neste pacote. O caminho mais simples é **TiDB Cloud Serverless** (MySQL compatível, plano gratuito, o mesmo motor que o Manus usava), sem mudar nada no código.

1. Crie uma conta em tidbcloud.com e um cluster **Serverless** (região mais próxima, ex.: São Paulo/N. Virginia).
2. Em *Connect*, gere a senha e copie host, porta (4000), usuário e nome do banco.
3. Monte a `DATABASE_URL` com SSL (valor com URL-encode do JSON do `ssl`):

   ```
   mysql://USUARIO:SENHA@HOST:4000/BANCO?ssl=%7B%22minVersion%22%3A%22TLSv1.2%22%2C%22rejectUnauthorized%22%3Atrue%7D
   ```
4. Alternativas equivalentes: PlanetScale, Railway MySQL, Aiven, Amazon RDS. Qualquer MySQL 8 serve.

Os dados antigos do Manus **não** vêm junto: o banco novo nasce vazio e é preenchido pela primeira sincronização com a API CSAgenda. Cadastros manuais feitos só no Manus (check-ins semanais, riscos, snapshots de Curva S) precisam ser exportados pela tela do Manus, se ainda forem necessários.

## 2. Preparar o banco e o primeiro administrador

```bash
cp .env.example .env        # preencher DATABASE_URL e JWT_SECRET (openssl rand -hex 32)
pnpm install
pnpm drizzle-kit migrate    # aplica as migrações 0000..0028 em um banco vazio
ADMIN_EMAIL=voce@empresa.com ADMIN_NAME="Seu Nome" ADMIN_PASSWORD='senha-longa' pnpm admin:create
```

Revise o SQL das migrações antes de rodar em qualquer banco que já tenha dados.

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

`pnpm build && pnpm start` (porta `PORT`, padrão 3000). Opções: Railway, Render, Fly.io ou uma VPS, sempre atrás de HTTPS (o cookie de sessão é `secure`). Variáveis: `DATABASE_URL`, `JWT_SECRET`, `ORACLE_API_TOKEN`, `NODE_ENV=production`.

## 6. Pontos conhecidos

- **Anexos de check-in** ainda usam o armazenamento do Manus (`BUILT_IN_FORGE_*`). Sem essas variáveis, o envio de anexo falha; o restante funciona. Migrar para S3 compatível é um próximo passo.
- Fotos diárias começam a existir a partir da primeira execução; não há histórico retroativo.
- Limite de tentativas de login é em memória (reinicia com o servidor); com várias instâncias, mover para o banco/Redis.
