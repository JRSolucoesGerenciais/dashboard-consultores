# Auditoria da API SQL Rev07 — 05/10/2026

## Fontes

- SQL recebida: `SQL_API_Gestao_Projetos_Consolidada_Rev07_Sem_HTML_Resumo_Gestao_Modulo.sql`.
- Especificação funcional: `pasted_content_4.txt`.

## Contrato efetivo no SELECT final

A SQL final publica, entre outras, as colunas `cod_projeto`, `codgestao`, `gestao_descricao`, `codmodulo`, `modulo_descricao`, `idppsa`, `nivel`, `nivelfilho`, `nivelpai`, `qtd_semana_planejada`, `horas_modulo_planejadas`, `total_hora_dias_programados`, `horas_total`, `percentual_horas_realizada_original`, `status_estouro_horas`, `status_atividade`, `tipo_registro`, `possui_cronograma` e `id_pai_ppsa`.

Os totalizadores oficiais de módulo são publicados como `horas_modulo_planejadas_decimal`, `horas_modulo_planejadas_hhmm`, `horas_realizadas_modulo_decimal`, `horas_realizadas_modulo_hhmm` e `percentual_horas_modulo_realizado`.

A árvore publica `horas_atividade_planejadas_decimal`, `horas_atividade_planejadas_hhmm`, `horas_realizadas_atomicas_decimal`, `horas_realizadas_atomicas_hhmm`, `horas_realizadas_consolidadas_decimal` e `horas_realizadas_consolidadas_hhmm`. Os campos de compatibilidade `total_hora_dias_programados` e `horas_total` representam a linha hierárquica, não o total do módulo.

Também são publicados `resumo_modulo_horas_planejadas_decimal`, `resumo_modulo_horas_planejadas_hhmm`, `resumo_modulo_horas_realizadas_decimal`, `resumo_modulo_horas_realizadas_hhmm`, `resumo_modulo_percentual_realizado`, `resumo_gestao_horas_planejadas_decimal`, `resumo_gestao_horas_planejadas_hhmm`, `resumo_gestao_horas_realizadas_decimal`, `resumo_gestao_horas_realizadas_hhmm` e `resumo_gestao_percentual_realizado`.

## Regra de integração

A aplicação deve usar os campos `*_modulo_*` para cards, dashboards e resumo por módulo; `resumo_gestao_*` para o resumo da gestão; e os campos de atividade/árvore exclusivamente para a visualização hierárquica. Não deve somar N1 + N2 + N3.

A carga é considerada válida somente quando os campos oficiais de planejado e realizado do módulo estão presentes. Os três campos HTML removidos continuam opcionais e não participam da detecção.

A aplicação preserva a árvore e os valores por linha, grava `moduleActualHours` em coluna própria e usa o valor oficial de módulo apenas no total executivo. Uma carga antiga sem realizado oficial por módulo permanece bloqueada para evitar que `horas_total` de linhas hierárquicas seja promovido indevidamente.
