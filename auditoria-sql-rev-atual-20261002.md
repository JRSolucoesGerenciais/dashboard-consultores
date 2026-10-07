

## Atualização da auditoria — 02/10/2026 10:48 BRT

Uma nova consulta HTTP confirmou que o endpoint foi atualizado parcialmente para a RevAtual:

- 34.244 registros, 329 projetos e 60 colunas.
- A coluna de planejamento por módulo chegou com o alias real `HORAS_MODULO_PLANEJADAS` (e não `HORAS_PLANEJADAS_MODULO`).
- `QTD_SEMANA_PLANEJADA`, `UTILIZACAO_PERC`, `UTILIZACAO_PERC_NIVEL`, `TOTAL_UTILIZACAO_NIVEL` e os três campos HTML chegaram no payload.
- O Projeto Majaguas #122 chegou com 10 linhas fora do escopo, totalizando 1.000,0 h, e o planejamento por Gestão/Módulo totaliza 6.960,0 h: 5.960,0 h no cronograma + 1.000,0 h fora.
- A SQL não envia `HORAS_PRODUTIVAS_REALIZADAS` nem `HORAS_IMPRODUTIVAS_REALIZADAS`. Portanto `HORAS_TOTAL` é tratado como realizado operacional; a aplicação não cria improdutividade artificial.

A correção aplicada no importador reconhece `HORAS_MODULO_PLANEJADAS`, espelha suas horas em `plannedModuleHours`, classifica as linhas fora do escopo sem PPSA como nível 0 e revalida automaticamente uma prévia antiga no momento do clique em importar. Com o payload auditado, a prévia fica importável e reconcilia o plano do Majaguas.
