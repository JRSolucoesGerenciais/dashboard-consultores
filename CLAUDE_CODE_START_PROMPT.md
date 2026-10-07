Você está recebendo o repositório CS Project Management / Gestão 360°. Leia primeiro `CLAUDE.md` e `TRANSFER_README.md`. Não reescreva a aplicação. Continue a finalização a partir do estado atual.

Objetivos imediatos:
1. Executar `pnpm install`, `pnpm check`, `pnpm test`, `pnpm build` e `git diff --check`.
2. Se houver falha, separar erro de ambiente de erro de produto e corrigir a causa real.
3. Validar as rotas `/`, `/projeto/122`, `/projeto/200`, `/controle-visual` e `/atualizar-planilha`.
4. Conferir os valores dos projetos 122 e 200 com uma resposta atual da API CSAgenda, sem usar números históricos como override.
5. Preservar as regras Rev07: API como fonte oficial, nenhum `SUM` de níveis N1/N2/N3/N4, resumos oficiais de gestão/módulo e distinção entre horas atômicas e consolidadas.
6. Ler `todo.md` e preparar um plano de conclusão com testes antes de publicar.

Não use credenciais reais no código. Não publique nem altere banco de produção sem mostrar o plano, o diff e os resultados dos testes.
