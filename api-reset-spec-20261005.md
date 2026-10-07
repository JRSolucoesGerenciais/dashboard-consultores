# Contrato de recomeço da API de Gestão de Projetos — 05/10/2026

Fonte enviada pelo usuário: `/home/ubuntu/upload/pasted_content_3.txt`.

## Regras obrigatórias

- A API é a fonte de planejado, realizado, hierarquia, status e percentuais; o front-end não recalcula regras de negócio.
- Contexto obrigatório: `COD_PROJETO + CODGESTAO + CODMODULO`; não cruzar ou somar Gestão/Módulo diferentes.
- Hierarquia: `IDPPSA`, `ID_PAI` e `NIVEL`; N3 pertence a N2 e N2 pertence a N1. Não reconstruir pai pelo texto.
- Capacidade oficial do módulo: `QTD_SEMANA_PLANEJADA × 40`, ou campo oficial equivalente da API (`HORAS_MODULO_PLANEJADAS_DECIMAL/HORAS_MODULO_PLANEJADAS`).
- Planejado da atividade: respeitar `UTILIZACAO_PERC_NIVEL`/`TOTAL_UTILIZACAO_NIVEL` fornecidos pela API; nunca distribuir a capacidade inteira novamente por atividade.
- Total de módulo: usar uma única camada/capacidade, nunca `N1 + N2 + N3`.
- Realizado atômico: origem em `PROCESSORELATORIOHORARIOS`, diferença entre `DATAHORAINICIO` e `DATAHORATERMINO`, cada apontamento uma única vez.
- Dashboard: usar `HORAS_REALIZADAS_MODULO_DECIMAL/HORAS_REALIZADAS_MODULO_HHMM`; `HORAS_REALIZADAS_ATIVIDADE_*` é para a árvore.
- Percentual real pode passar de 100%; percentual de conclusão é separado e limitado a 100%.
- Fora do cronograma deve permanecer visível como realizado, com `POSSUI_CRONOGRAMA=N`.
- Módulo planejado sem PPSA deve continuar visível com `IDPPSA/NIVEL nulos`.
- Conversão decimal/HH:MM deve vir da API; exemplo `227,2` decimal = `227:12`.
- Colunas HTML são apresentacionais e não são obrigatórias para o contrato estrutural.

## Contrato mínimo que a aplicação deverá exigir na nova carga

- Identificação: `COD_PROJETO`, `CODGESTAO`, `CODMODULO`, `IDPPSA`, `ID_PAI`, `NIVEL`.
- Planejado: `QTD_SEMANA_PLANEJADA` e `HORAS_MODULO_PLANEJADAS_DECIMAL`/`HORAS_MODULO_PLANEJADAS`.
- Atividade planejada: `HORAS_PLANEJADAS_ATIVIDADE_DECIMAL` ou alias operacional equivalente.
- Realizado de atividade: `HORAS_REALIZADAS_ATIVIDADE_DECIMAL` ou alias operacional `HORAS_TOTAL` quando explicitamente documentado como atividade.
- Realizado de módulo: `HORAS_REALIZADAS_MODULO_DECIMAL` ou `HORAS_REALIZADAS_MODULO`.

## Auditoria do endpoint atualmente configurado

URL configurada na aplicação: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2`.

URL testada pelo usuário em 05/10: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=28&projeto=200`.

No sandbox, a consulta 2 filtrada por projeto 200 respondeu HTTP 200 com 435 linhas e colunas operacionais antigas (`HORAS_TOTAL`, `HORAS_MODULO_PLANEJADAS`), mas não os campos oficiais separados de realizado por módulo.

No sandbox, a consulta 28 respondeu HTTP 200 com `error_code=404` e `Consulta não implementada` no momento da auditoria. Portanto a aplicação não deve trocar a URL para consulta 28 automaticamente nem inventar o valor que apareceu em uma captura anterior.

## Decisão do recomeço

- Preservar a integração, staging, importação, filtros e layouts.
- Limpar a camada provisória de tratamento e criar uma camada canônica baseada nos campos oficiais acima.
- Bloquear publicação da carga nova quando o realizado oficial de módulo não estiver presente, para evitar que `SUM(HORAS_TOTAL)` de níveis propagados seja apresentado como total executivo.
