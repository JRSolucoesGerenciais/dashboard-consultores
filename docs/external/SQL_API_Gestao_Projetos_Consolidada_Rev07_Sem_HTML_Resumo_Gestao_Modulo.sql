/* ============================================================================
   API GESTAO DE PROJETOS - CONSULTA CONSOLIDADA - REV06 API - HORAS SEM AMBIGUIDADE

   PARAMETROS (Oracle bind variables):
     :P_PROJETO       NUMBER    -> 0 ou NULL = todos; numero = projeto especifico
     :P_GESTAO        NUMBER    -> 0 ou NULL = todas
     :P_MODULO        NUMBER    -> 0 ou NULL = todos
     :P_DATA_INI      VARCHAR2  -> data inicial conforme regra existente; NULL = sem filtro
     :P_DATA_PREVISTA VARCHAR2  -> 'Y' usa inicio_programado; diferente de 'Y' usa inicio_realizado

   FONTES CONSOLIDADAS:
     1) Cronograma / atividades programadas e realizadas (mesma logica do sistema)
     2) Gestao + modulo planejados em PROJETOMODULO sem cronograma (fora do escopo)

   OBSERVACAO:
     - As colunas do SELECT original foram mantidas.
     - Linhas fora do escopo possuem IDPPSA/NIVEL/estrutura PPSA nulos, porque nao
       existe atividade de cronograma vinculada para aquela Gestao + Modulo.
     - A hierarquia foi reforcada por Projeto + Gestao + Modulo para evitar mistura
       entre N1/N2/N3 de modulos distintos.
     - REV06 separa explicitamente capacidade do modulo, planejado da linha,
       realizado atomico, realizado consolidado da hierarquia e realizado do modulo.
     - HORAS_TOTAL continua existindo por compatibilidade, mas representa SOMENTE
       o realizado consolidado da linha hierarquica (N1/N2/N3), nunca o total do modulo.
     - Para dashboards/totais do modulo, usar HORAS_REALIZADAS_MODULO_DECIMAL ou
       HORAS_REALIZADAS_MODULO_HHMM. Nunca somar N1 + N2 + N3.
   ============================================================================ */

WITH ppsa_peso AS (SELECT p.idppsa,
p.codgestao,
p.codmodulo,
p.nivel,
NVL(p.utilizacao_perc,
0) AS utilizacao_perc,
SUM(NVL(p.utilizacao_perc,
0)) OVER (PARTITION BY p.codgestao, p.codmodulo, p.nivel) AS total_utilizacao_nivel,
ROUND(NVL(p.utilizacao_perc,
0) /
NULLIF(SUM(NVL(p.utilizacao_perc,
0))
OVER(PARTITION BY
p.codgestao,
p.codmodulo,
p.nivel),
0) * 100,
6) AS utilizacao_perc_nivel
FROM segurancanovo.implantacao_ppsa p
WHERE NVL(p.ativo,
'S') = 'S'), raw_data AS (SELECT x.idprojetocronograma,
x.cod_projeto,
ip.nome_projeto,
ip.data_inicio AS projeto_data_inicio,
ip.data_termino AS projeto_data_termino,
ip.gestor_conta,
usu.logon AS gestor_logon,
usu.logon_email AS gestor_email,
ip.projeto_encerrado,
ip.data_escopo,
ip.data_finalizacao_projeto,
ip.responsavel_cliente,
ip.hora_inicio_manha,
ip.hora_termino_manha,
ip.hora_inicio_tarde,
ip.hora_termino_tarde,
ip.email_responsavel AS email_responsavel_cliente,
ip.id_segmento,
ip.fase,
ip.tipo_projeto,
tip.descricao AS tipo_projeto_descricao,
ip.cod_cliente,
cli.cliente_nome,
x.idppsa,
x.codppsa,
x.descricao,
x.tempopadrao,
x.projeto,
x.processo,
x.subprocesso,
x.atividade,
pm.data_inicio AS inicio_programado,
pm.data_termino AS termino_programado,
CASE
WHEN pm.qtd_semana_planejada IS NOT NULL THEN
ROUND((pm.qtd_semana_planejada * 5) *
(NVL(x.utilizacao_perc_nivel,
0) / 100),
4)
ELSE
x.diff_dias_programada
END AS diff_dias_programada,
x.recurso,
x.local,
x.codgestao,
ges.descricao AS gestao_descricao,
x.codmodulo,
modu.descricao AS modulo_descricao,
x.utilizacao_perc,
x.utilizacao_perc_nivel,
x.total_utilizacao_nivel,
x.nivel,
x.nivelfilho,
x.nivelpai,
CASE
WHEN pm.qtd_semana_planejada IS NOT NULL THEN
geral.hora_normal((pm.qtd_semana_planejada * 40) *
(NVL(x.utilizacao_perc_nivel,
0) / 100))
ELSE
x.total_hora_dias_programados
END AS base_total_hora_dias_programados,
NVL(pm.data_inicio_realizado,
x.inicio_realizado) AS inicio_realizado,
pm.data_termino_realizado AS fim_realizado,
x.percentual_dias_realizado,
NVL(x.horas_total,
'0:00') AS horas_total,
pm.qtd_semana_planejada,
CASE
WHEN pm.qtd_semana_planejada IS NOT NULL THEN
pm.qtd_semana_planejada * 40
ELSE
0
END AS horas_modulo_planejadas,
CASE
WHEN pm.data_termino_realizado IS NOT NULL THEN
'CONCLUIDA'
WHEN NVL(pm.data_inicio_realizado,
x.inicio_realizado) IS NOT NULL THEN
'EM ANDAMENTO'
WHEN pm.data_termino IS NOT NULL AND
pm.data_termino <
TRUNC(SYSDATE) THEN
'ATRASADA'
ELSE
'NAO INICIADO'
END AS status_atividade,
pm.data_termino_realizado AS data_termino_realizado_modulo
FROM (SELECT idprojetocronograma,
cod_projeto,
idppsa,
codppsa,
descricao,
tempopadrao,
projeto,
processo,
subprocesso,
atividade,
data_inicio_programada,
data_termino_programada,
diff_dias_programada,
recurso,
local,
percentual_conclusao,
codgestao,
codmodulo,
utilizacao_perc,
utilizacao_perc_nivel,
total_utilizacao_nivel,
nivel,
nivelfilho,
nivelpai,
total_hora_dias_programados,
inicio_realizado,
fim_realizado,
percentual_dias_realizado || '%' AS percentual_dias_realizado,
CASE
WHEN geral.hora_normal(DECODE(nivel,
1,
SUM(hora),
SUM(horas_cem_apontada))) = ':' THEN
NULL
ELSE
geral.hora_normal(DECODE(nivel,
1,
SUM(hora),
SUM(horas_cem_apontada)))
END AS horas_total
FROM (SELECT tmp_base.idprojetocronograma,
tmp_base.cod_projeto,
tmp_base.idppsa,
tmp_base.codppsa,
tmp_base.descricao,
tmp_base.tempopadrao,
tmp_base.atividade,
tmp_base.processo,
tmp_base.subprocesso,
tmp_base.projeto,
tmp_base.data_inicio_programada,
tmp_base.data_termino_programada,
tmp_base.diff_dias_programada,
tmp_base.recurso,
tmp_base.local,
tmp_base.percentual_conclusao,
tmp_base.data_inicio_realizada,
tmp_base.data_termino_realizada,
tmp_base.codgestao,
tmp_base.codmodulo,
tmp_base.utilizacao_perc,
tmp_base.utilizacao_perc_nivel,
tmp_base.total_utilizacao_nivel,
tmp_base.nivel,
tmp_base.nivelfilho,
tmp_base.nivelpai,
geral.hora_normal(tmp_base.total_horas_programadas *
tmp_base.diff_dias_programada) AS total_hora_dias_programados,
tmp_realizado.inicio_realizado,
tmp_realizado.fim_realizado,
(((csos.pkg_acomp_cs.fn_dias_uteis_hora(vdata1 => tmp_realizado.inicio_realizado,
vdata2 => tmp_realizado.fim_realizado) / 24) + 1) /
NULLIF(tmp_base.diff_dias_programada,
0)) * 100 AS percentual_dias_realizado,
geral.hora_centesimal(tmp_horas_atividade.hora) AS horas_cem_apontada,
tmp_calculo_rel.hora
FROM (SELECT ip.idprojetocronograma,
ip.cod_projeto,
ip.idppsa,
ippsa.projeto || '.' ||
ippsa.processo || '.' ||
ippsa.subprocesso || '.' ||
ippsa.atividade AS codppsa,
ippsa.descricao,
ippsa.tempopadrao,
ippsa.atividade,
ippsa.processo,
ippsa.subprocesso,
ippsa.projeto,
ip.data_inicio_programada,
ip.data_termino_programada,
(csos.pkg_acomp_cs.fn_dias_uteis_hora(vdata1 => ip.data_inicio_programada,
vdata2 => ip.data_termino_programada) / 24) + 1 AS diff_dias_programada,
ip.recurso,
ip.local,
ip.percentual_conclusao,
ip.data_inicio_realizada,
ip.data_termino_realizada,
ippsa.codgestao,
ippsa.codmodulo,
peso.utilizacao_perc,
peso.utilizacao_perc_nivel,
peso.total_utilizacao_nivel,
ippsa.nivel,
ippsa.idppsa || '.' ||
ippsa.nivel AS nivelfilho,
DECODE(ippsa.nivel,
1,
NULL,
ippsa.id_pai || '.' ||
(ippsa.nivel - 1)) AS nivelpai,
geral.hora_centesimal(NVL(improj.hora_termino_manha,
'00:00')) -
geral.hora_centesimal(NVL(improj.hora_inicio_manha,
'00:00')) +
geral.hora_centesimal(NVL(improj.hora_termino_tarde,
'00:00')) -
geral.hora_centesimal(NVL(improj.hora_inicio_tarde,
'00:00')) AS total_horas_programadas
FROM segurancanovo.implantacaoprojeto            improj,
segurancanovo.implantacao_ppsa              ippsa,
segurancanovo.implantacao_projetocronograma ip,
ppsa_peso                                   peso
WHERE improj.codigo =
ip.cod_projeto
AND ippsa.nivel IN (1, 2, 3)
AND ippsa.idppsa =
ip.idppsa
AND peso.idppsa =
ippsa.idppsa
AND (NVL(:P_PROJETO, 0) = 0 OR ip.cod_projeto = :P_PROJETO)) tmp_base
LEFT JOIN (SELECT MIN(pro_rel.data_visita) AS inicio_realizado,
MAX(pro_rel.data_visita) AS fim_realizado,
imp_proj_cro.cod_projeto AS c_proj,
imp_proj_cro.idppsa AS c_id
FROM segurancanovo.processorelatorio             pro_rel,
segurancanovo.processorelatorio_atividades  pro_ativ,
segurancanovo.implantacao_projetocronograma imp_proj_cro
WHERE pro_rel.id_processorelatorio =
pro_ativ.id_processorelatorio
AND pro_rel.id_projeto =
imp_proj_cro.cod_projeto
AND pro_ativ.idppsa =
imp_proj_cro.idppsa
AND (NVL(:P_PROJETO, 0) = 0 OR imp_proj_cro.cod_projeto = :P_PROJETO)
GROUP BY imp_proj_cro.cod_projeto,
imp_proj_cro.idppsa) tmp_realizado
ON tmp_base.cod_projeto =
tmp_realizado.c_proj
AND tmp_base.idppsa =
tmp_realizado.c_id
LEFT JOIN (SELECT geral.hora_normal(SUM((TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahoratermino,
'dd/mm/rrrr hh24:mi') -
TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahorainicio,
'dd/mm/rrrr hh24:mi')) * 24)) AS hora,
processorelatorio.id_projeto AS c_proj,
fam.idppsa AS c_id
FROM segurancanovo.processorelatoriohorarios     h,
segurancanovo.implantacao_projetocronograma cronograma,
segurancanovo.processorelatorio_atividades  processo_atividades,
segurancanovo.processorelatorio             processorelatorio,
segurancanovo.implantacao_ppsa              base_ppsa,
segurancanovo.implantacao_ppsa              fam
WHERE h.id_procrel_atividade IN
(processo_atividades.id_procrel_atividade)
AND cronograma.idprojetocronograma(+) =
processo_atividades.id_projetocronograma
AND processo_atividades.id_processorelatorio =
processorelatorio.id_processorelatorio
AND base_ppsa.idppsa =
processo_atividades.idppsa
AND (fam.idppsa =
base_ppsa.idppsa OR
fam.idppsa =
base_ppsa.id_pai)
AND (NVL(:P_PROJETO, 0) = 0 OR processorelatorio.id_projeto = :P_PROJETO)
GROUP BY processorelatorio.id_projeto,
fam.idppsa) tmp_horas_atividade
ON tmp_base.cod_projeto =
tmp_horas_atividade.c_proj
AND tmp_base.idppsa =
tmp_horas_atividade.c_id
LEFT JOIN (SELECT SUM((TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahoratermino,
'dd/mm/rrrr hh24:mi') -
TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahorainicio,
'dd/mm/rrrr hh24:mi')) * 24) AS hora,
processorelatorio.id_projeto AS id_projeto,
imp_ppsa.projeto AS ppsa_projeto
FROM segurancanovo.implantacao_ppsa              imp_ppsa,
segurancanovo.processorelatoriohorarios     h,
segurancanovo.implantacao_projetocronograma cronograma,
segurancanovo.processorelatorio_atividades  processo_atividades,
segurancanovo.processorelatorio             processorelatorio
WHERE imp_ppsa.idppsa =
processo_atividades.idppsa
AND h.id_procrel_atividade IN
(processo_atividades.id_procrel_atividade)
AND cronograma.idprojetocronograma(+) =
processo_atividades.id_projetocronograma
AND processo_atividades.id_processorelatorio =
processorelatorio.id_processorelatorio
AND (NVL(:P_PROJETO, 0) = 0 OR processorelatorio.id_projeto = :P_PROJETO)
GROUP BY processorelatorio.id_projeto,
imp_ppsa.projeto) tmp_calculo_rel
ON tmp_base.cod_projeto =
tmp_calculo_rel.id_projeto
AND tmp_base.projeto =
tmp_calculo_rel.ppsa_projeto)
GROUP BY idprojetocronograma,
cod_projeto,
idppsa,
codppsa,
descricao,
tempopadrao,
atividade,
processo,
subprocesso,
projeto,
data_inicio_programada,
data_termino_programada,
diff_dias_programada,
recurso,
local,
percentual_conclusao,
data_inicio_realizada,
data_termino_realizada,
codgestao,
codmodulo,
utilizacao_perc,
utilizacao_perc_nivel,
total_utilizacao_nivel,
nivel,
nivelfilho,
nivelpai,
total_hora_dias_programados,
inicio_realizado,
fim_realizado,
percentual_dias_realizado) x
LEFT JOIN segurancanovo.projetomodulo pm
ON x.cod_projeto =
pm.id_projeto
AND x.codgestao =
pm.cod_gestao
AND x.codmodulo =
pm.cod_modulo
LEFT JOIN segurancanovo.implantacaoprojeto ip
ON ip.codigo =
x.cod_projeto
LEFT JOIN cscv.cliente cli
ON cli.cliente_codigo =
ip.cod_cliente
LEFT JOIN segurancanovo.usuario usu
ON usu.id_logon =
ip.gestor_conta
LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
ON tip.id_tipo_proj =
ip.tipo_projeto
LEFT JOIN segurancanovo.gestao ges
ON ges.codgestao =
x.codgestao
LEFT JOIN segurancanovo.modulo modu
ON modu.codgestao =
x.codgestao
AND modu.codmodulo =
x.codmodulo
UNION ALL
SELECT NULL AS idprojetocronograma,
horas_apont.cod_projeto,
ip.nome_projeto,
ip.data_inicio AS projeto_data_inicio,
ip.data_termino AS projeto_data_termino,
ip.gestor_conta,
usu.logon AS gestor_logon,
usu.logon_email AS gestor_email,
ip.projeto_encerrado,
ip.data_escopo,
ip.data_finalizacao_projeto,
ip.responsavel_cliente,
ip.hora_inicio_manha,
ip.hora_termino_manha,
ip.hora_inicio_tarde,
ip.hora_termino_tarde,
ip.email_responsavel AS email_responsavel_cliente,
ip.id_segmento,
ip.fase,
ip.tipo_projeto,
tip.descricao AS tipo_projeto_descricao,
ip.cod_cliente,
cli.cliente_nome,
ppsa.idppsa,
ppsa.projeto || '.' ||
ppsa.processo || '.' ||
ppsa.subprocesso || '.' ||
ppsa.atividade AS codppsa,
ppsa.descricao,
ppsa.tempopadrao,
ppsa.projeto,
ppsa.processo,
ppsa.subprocesso,
ppsa.atividade,
NULL AS inicio_programado,
NULL AS termino_programado,
0 AS diff_dias_programada,
NULL AS recurso,
NULL AS local,
ppsa.codgestao,
ges.descricao AS gestao_descricao,
ppsa.codmodulo,
modu.descricao AS modulo_descricao,
peso.utilizacao_perc,
peso.utilizacao_perc_nivel,
peso.total_utilizacao_nivel,
ppsa.nivel,
ppsa.idppsa || '.' ||
ppsa.nivel AS nivelfilho,
DECODE(ppsa.nivel,
1,
NULL,
ppsa.id_pai || '.' ||
(ppsa.nivel - 1)) AS nivelpai,
'0:00' AS base_total_hora_dias_programados,
NVL(pm.data_inicio_realizado,
rel.data_visita) AS inicio_realizado,
pm.data_termino_realizado AS fim_realizado,
NULL AS percentual_dias_realizado,
NVL(horas_apont.total_horas,
'0:00') AS horas_total,
pm.qtd_semana_planejada,
CASE
WHEN pm.qtd_semana_planejada IS NOT NULL THEN
pm.qtd_semana_planejada * 40
ELSE
0
END AS horas_modulo_planejadas,
CASE
WHEN pm.data_termino_realizado IS NOT NULL THEN
'CONCLUIDA'
WHEN horas_apont.total_horas IS NOT NULL THEN
'EM ANDAMENTO'
ELSE
'NAO INICIADO'
END AS status_atividade,
pm.data_termino_realizado AS data_termino_realizado_modulo
FROM (SELECT pro_rel.id_projeto AS cod_projeto,
NVL(base_ppsa.id_pai,
base_ppsa.idppsa) AS idppsa_agrup,
base_ppsa.idppsa AS idppsa_original,
geral.hora_normal(SUM((TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahoratermino,
'dd/mm/rrrr hh24:mi') -
TO_DATE(TO_CHAR(SYSDATE,
'dd/mm/rrrr') ||
h.datahorainicio,
'dd/mm/rrrr hh24:mi')) * 24)) AS total_horas
FROM segurancanovo.processorelatoriohorarios    h,
segurancanovo.processorelatorio_atividades pra,
segurancanovo.processorelatorio            pro_rel,
segurancanovo.implantacao_ppsa             base_ppsa
WHERE h.id_procrel_atividade IN
(pra.id_procrel_atividade)
AND pra.id_processorelatorio =
pro_rel.id_processorelatorio
AND base_ppsa.idppsa =
pra.idppsa
AND (NVL(:P_PROJETO, 0) = 0 OR pro_rel.id_projeto = :P_PROJETO)
GROUP BY pro_rel.id_projeto,
NVL(base_ppsa.id_pai,
base_ppsa.idppsa),
base_ppsa.idppsa) horas_apont
LEFT JOIN (SELECT pro_rel.id_projeto,
pra.idppsa,
MIN(pro_rel.data_visita) AS data_visita
FROM segurancanovo.processorelatorio            pro_rel,
segurancanovo.processorelatorio_atividades pra
WHERE pro_rel.id_processorelatorio =
pra.id_processorelatorio
AND (NVL(:P_PROJETO, 0) = 0 OR pro_rel.id_projeto = :P_PROJETO)
GROUP BY pro_rel.id_projeto,
pra.idppsa) rel
ON rel.id_projeto =
horas_apont.cod_projeto
AND rel.idppsa =
horas_apont.idppsa_original
LEFT JOIN segurancanovo.implantacao_ppsa ppsa
ON ppsa.idppsa =
horas_apont.idppsa_original
LEFT JOIN ppsa_peso peso
ON peso.idppsa =
ppsa.idppsa
LEFT JOIN segurancanovo.implantacaoprojeto ip
ON ip.codigo =
horas_apont.cod_projeto
LEFT JOIN cscv.cliente cli
ON cli.cliente_codigo =
ip.cod_cliente
LEFT JOIN segurancanovo.usuario usu
ON usu.id_logon =
ip.gestor_conta
LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
ON tip.id_tipo_proj =
ip.tipo_projeto
LEFT JOIN segurancanovo.gestao ges
ON ges.codgestao =
ppsa.codgestao
LEFT JOIN segurancanovo.modulo modu
ON modu.codgestao =
ppsa.codgestao
AND modu.codmodulo =
ppsa.codmodulo
LEFT JOIN segurancanovo.projetomodulo pm
ON pm.id_projeto =
horas_apont.cod_projeto
AND pm.cod_gestao =
ppsa.codgestao
AND pm.cod_modulo =
ppsa.codmodulo
WHERE NOT
EXISTS
(SELECT 1
FROM segurancanovo.implantacao_projetocronograma ipc
WHERE ipc.cod_projeto =
horas_apont.cod_projeto
AND ipc.idppsa =
horas_apont.idppsa_original)
AND (NVL(:P_PROJETO, 0) = 0 OR horas_apont.cod_projeto = :P_PROJETO)
GROUP BY horas_apont.cod_projeto,
ip.nome_projeto,
ip.data_inicio,
ip.data_termino,
ip.gestor_conta,
usu.logon,
usu.logon_email,
ip.projeto_encerrado,
ip.data_escopo,
ip.data_finalizacao_projeto,
ip.responsavel_cliente,
ip.hora_inicio_manha,
ip.hora_termino_manha,
ip.hora_inicio_tarde,
ip.hora_termino_tarde,
ip.email_responsavel,
ip.id_segmento,
ip.fase,
ip.tipo_projeto,
tip.descricao,
ip.cod_cliente,
cli.cliente_nome,
ppsa.idppsa,
ppsa.projeto,
ppsa.processo,
ppsa.subprocesso,
ppsa.atividade,
ppsa.descricao,
ppsa.tempopadrao,
ppsa.codgestao,
ges.descricao,
ppsa.codmodulo,
modu.descricao,
peso.utilizacao_perc,
peso.utilizacao_perc_nivel,
peso.total_utilizacao_nivel,
ppsa.nivel,
ppsa.id_pai,
horas_apont.total_horas,
rel.data_visita,
pm.qtd_semana_planejada,
pm.data_inicio_realizado,
pm.data_termino_realizado
UNION ALL
SELECT NULL AS idprojetocronograma,
pm.id_projeto AS cod_projeto,
ip.nome_projeto,
ip.data_inicio AS projeto_data_inicio,
ip.data_termino AS projeto_data_termino,
ip.gestor_conta,
usu.logon AS gestor_logon,
usu.logon_email AS gestor_email,
ip.projeto_encerrado,
ip.data_escopo,
ip.data_finalizacao_projeto,
ip.responsavel_cliente,
ip.hora_inicio_manha,
ip.hora_termino_manha,
ip.hora_inicio_tarde,
ip.hora_termino_tarde,
ip.email_responsavel AS email_responsavel_cliente,
ip.id_segmento,
ip.fase,
ip.tipo_projeto,
tip.descricao AS tipo_projeto_descricao,
ip.cod_cliente,
cli.cliente_nome,
ppsa.idppsa,
ppsa.projeto || '.' ||
ppsa.processo || '.' ||
ppsa.subprocesso || '.' ||
ppsa.atividade AS codppsa,
ppsa.descricao,
ppsa.tempopadrao,
ppsa.projeto,
ppsa.processo,
ppsa.subprocesso,
ppsa.atividade,
NULL AS inicio_programado,
NULL AS termino_programado,
0 AS diff_dias_programada,
NULL AS recurso,
NULL AS local,
ppsa.codgestao,
ges.descricao AS gestao_descricao,
ppsa.codmodulo,
modu.descricao AS modulo_descricao,
peso.utilizacao_perc,
peso.utilizacao_perc_nivel,
peso.total_utilizacao_nivel,
ppsa.nivel,
ppsa.idppsa || '.' ||
ppsa.nivel AS nivelfilho,
DECODE(ppsa.nivel,
1,
NULL,
ppsa.id_pai || '.' ||
(ppsa.nivel - 1)) AS nivelpai,
'0:00' AS base_total_hora_dias_programados,
NULL AS inicio_realizado,
NULL AS fim_realizado,
NULL AS percentual_dias_realizado,
'0:00' AS horas_total,
pm.qtd_semana_planejada,
CASE
WHEN pm.qtd_semana_planejada IS NOT NULL THEN
pm.qtd_semana_planejada * 40
ELSE
0
END AS horas_modulo_planejadas,
'NAO INICIADO' AS status_atividade,
NULL AS data_termino_realizado_modulo
FROM segurancanovo.projetomodulo pm
INNER JOIN segurancanovo.implantacao_ppsa ppsa
ON ppsa.codgestao =
pm.cod_gestao
AND ppsa.codmodulo =
pm.cod_modulo
LEFT JOIN ppsa_peso peso
ON peso.idppsa =
ppsa.idppsa
LEFT JOIN segurancanovo.implantacaoprojeto ip
ON ip.codigo =
pm.id_projeto
LEFT JOIN cscv.cliente cli
ON cli.cliente_codigo =
ip.cod_cliente
LEFT JOIN segurancanovo.usuario usu
ON usu.id_logon =
ip.gestor_conta
LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
ON tip.id_tipo_proj =
ip.tipo_projeto
LEFT JOIN segurancanovo.gestao ges
ON ges.codgestao =
ppsa.codgestao
LEFT JOIN segurancanovo.modulo modu
ON modu.codgestao =
ppsa.codgestao
AND modu.codmodulo =
ppsa.codmodulo
WHERE ppsa.nivel = 3
AND NVL(ppsa.ativo,
'S') = 'S'
AND (NVL(:P_PROJETO, 0) = 0 OR pm.id_projeto = :P_PROJETO)
AND NOT
EXISTS
(SELECT 1
FROM segurancanovo.implantacao_projetocronograma ipc
WHERE ipc.cod_projeto =
pm.id_projeto
AND ipc.idppsa =
ppsa.idppsa)
AND NOT
EXISTS
(SELECT 1
FROM segurancanovo.processorelatorio pr
JOIN segurancanovo.processorelatorio_atividades pra
ON pra.id_processorelatorio =
pr.id_processorelatorio
WHERE pr.id_projeto =
pm.id_projeto
AND pra.idppsa =
ppsa.idppsa)), /* ============================================================================
   REV02 AUDITADA - HIERARQUIA DE HORAS POR IDPPSA/ID_PAI
   - PROGRAMADO: N3 atomico; N2 = soma dos N3 filhos; N1 = soma dos N2 filhos.
   - REALIZADO: soma direta dos apontamentos por IDPPSA e propagacao somente aos
     ancestrais reais (ID_PAI), evitando agrupamento por codigos projeto/processo.
   ============================================================================ */
/* ============================================================================
   REV04 - REALIZADO SEM DUPLICIDADE

   Problema corrigido:
   PROCESSORELATORIO_ATIVIDADES pode possuir mais de um IDPPSA para o mesmo
   ID_PROCREL_ATIVIDADE. Se as horas forem ligadas diretamente a todas essas
   linhas, o mesmo horario e somado varias vezes.

   Regra:
   1) identificar UMA PPSA atomica por atividade realizada;
   2) priorizar a PPSA de maior NIVEL (mais detalhada);
   3) somar PROCESSORELATORIOHORARIOS apenas uma vez;
   4) depois propagar a hora pela arvore IDPPSA -> ID_PAI.
   ============================================================================ */
horas_por_atividade AS (
    /*
       Soma o horario UMA UNICA VEZ por ID_PROCREL_ATIVIDADE.
       Esta e a base atomica do realizado e evita multiplicacao causada
       pelos vinculos existentes em PROCESSORELATORIO_ATIVIDADES.
    */
    SELECT h.id_procrel_atividade,
           SUM(
               (TO_DATE(TO_CHAR(SYSDATE,'dd/mm/rrrr') || h.datahoratermino,
                        'dd/mm/rrrr hh24:mi')
              - TO_DATE(TO_CHAR(SYSDATE,'dd/mm/rrrr') || h.datahorainicio,
                        'dd/mm/rrrr hh24:mi')) * 24
           ) AS horas_realizadas
      FROM segurancanovo.processorelatoriohorarios h
     GROUP BY h.id_procrel_atividade
),
atividade_ppsa_base AS (
    /*
       Mapeia cada atividade realizada para as PPSAs informadas no relatorio.
       Mantemos Projeto + Gestao + Modulo para nao perder o modulo correto.
    */
    SELECT DISTINCT
           pr.id_projeto AS cod_projeto,
           pra.id_processorelatorio,
           pra.id_procrel_atividade,
           pra.idppsa,
           p.nivel,
           p.codgestao,
           p.codmodulo
      FROM segurancanovo.processorelatorio pr
      JOIN segurancanovo.processorelatorio_atividades pra
        ON pra.id_processorelatorio = pr.id_processorelatorio
      JOIN segurancanovo.implantacao_ppsa p
        ON p.idppsa = pra.idppsa
     WHERE (NVL(:P_PROJETO,0) = 0 OR pr.id_projeto = :P_PROJETO)
),
atividade_modulo AS (
    /*
       Uma atividade/hora conta apenas uma vez dentro da mesma Gestao + Modulo,
       mesmo que existam varias PPSAs vinculadas a ela naquele modulo.
    */
    SELECT DISTINCT
           cod_projeto,
           id_procrel_atividade,
           codgestao,
           codmodulo
      FROM atividade_ppsa_base
),
realizado_modulo AS (
    /* Total realizado oficial por Projeto + Gestao + Modulo. */
    SELECT am.cod_projeto,
           am.codgestao,
           am.codmodulo,
           SUM(NVL(hpa.horas_realizadas,0)) AS horas_realizadas_modulo
      FROM atividade_modulo am
      LEFT JOIN horas_por_atividade hpa
        ON hpa.id_procrel_atividade = am.id_procrel_atividade
     GROUP BY am.cod_projeto, am.codgestao, am.codmodulo
),
atividade_ppsa_rank AS (
    /*
       Para detalhar N3/N2, escolhe uma PPSA atomica POR MODULO.
       O erro da REV04 era escolher uma unica PPSA global da atividade,
       podendo deslocar a hora para outro modulo/ramo da arvore.
    */
    SELECT b.*,
           ROW_NUMBER() OVER (
               PARTITION BY b.cod_projeto,
                            b.id_procrel_atividade,
                            b.codgestao,
                            b.codmodulo
               ORDER BY NVL(b.nivel,0) DESC, b.idppsa DESC
           ) AS rn
      FROM atividade_ppsa_base b
),
atividade_ppsa_unica AS (
    SELECT cod_projeto,
           id_processorelatorio,
           id_procrel_atividade,
           idppsa,
           nivel,
           codgestao,
           codmodulo
      FROM atividade_ppsa_rank
     WHERE rn = 1
),
realizado_direto AS (
    /*
       A hora atomica ja foi calculada em HORAS_POR_ATIVIDADE.
       Aqui apenas associamos a PPSA detalhada do modulo, sem recalcular horario.
    */
    SELECT apu.cod_projeto,
           apu.idppsa,
           apu.codgestao,
           apu.codmodulo,
           SUM(NVL(hpa.horas_realizadas,0)) AS horas_diretas
      FROM atividade_ppsa_unica apu
      LEFT JOIN horas_por_atividade hpa
        ON hpa.id_procrel_atividade = apu.id_procrel_atividade
     GROUP BY apu.cod_projeto,
              apu.idppsa,
              apu.codgestao,
              apu.codmodulo
),
ppsa_ancestral AS (
    /* propria PPSA */
    SELECT p.idppsa AS idppsa_origem,
           p.idppsa AS idppsa_destino
      FROM segurancanovo.implantacao_ppsa p

    UNION ALL

    /* pai */
    SELECT filho.idppsa,
           pai.idppsa
      FROM segurancanovo.implantacao_ppsa filho
      JOIN segurancanovo.implantacao_ppsa pai
        ON pai.idppsa = filho.id_pai

    UNION ALL

    /* avo */
    SELECT filho.idppsa,
           avo.idppsa
      FROM segurancanovo.implantacao_ppsa filho
      JOIN segurancanovo.implantacao_ppsa pai
        ON pai.idppsa = filho.id_pai
      JOIN segurancanovo.implantacao_ppsa avo
        ON avo.idppsa = pai.id_pai

    UNION ALL

    /* bisavo - cobre apontamento em nivel 4 */
    SELECT filho.idppsa,
           bisavo.idppsa
      FROM segurancanovo.implantacao_ppsa filho
      JOIN segurancanovo.implantacao_ppsa pai
        ON pai.idppsa = filho.id_pai
      JOIN segurancanovo.implantacao_ppsa avo
        ON avo.idppsa = pai.id_pai
      JOIN segurancanovo.implantacao_ppsa bisavo
        ON bisavo.idppsa = avo.id_pai
),
realizado_hierarquia AS (
    SELECT rd.cod_projeto,
           rd.codgestao,
           rd.codmodulo,
           pa.idppsa_destino AS idppsa,
           SUM(rd.horas_diretas) AS horas_realizadas
      FROM realizado_direto rd
      JOIN ppsa_ancestral pa
        ON pa.idppsa_origem = rd.idppsa
     GROUP BY rd.cod_projeto,
              rd.codgestao,
              rd.codmodulo,
              pa.idppsa_destino
),
n3_sums AS (
    SELECT r.cod_projeto,
           r.codgestao,
           r.codmodulo,
           p.id_pai AS idppsa_n2,
           SUM(NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0)) AS s3,
           SUM(NVL(r.diff_dias_programada,0)) AS s3_dias
      FROM raw_data r
      JOIN segurancanovo.implantacao_ppsa p
        ON p.idppsa = r.idppsa
     WHERE r.nivel = 3
     GROUP BY r.cod_projeto, r.codgestao, r.codmodulo, p.id_pai
),
n2_eff AS (
    SELECT b.cod_projeto,
           b.codgestao,
           b.codmodulo,
           b.idppsa,
           p2.id_pai AS idppsa_n1,
           NVL(s3.s3,
               NVL(geral.hora_centesimal(NULLIF(b.base_total_hora_dias_programados, ':')),0)) AS eff_val,
           NVL(s3.s3_dias, NVL(b.diff_dias_programada,0)) AS eff_dias
      FROM raw_data b
      LEFT JOIN segurancanovo.implantacao_ppsa p2
        ON p2.idppsa = b.idppsa
      LEFT JOIN n3_sums s3
        ON s3.cod_projeto = b.cod_projeto
       AND s3.codgestao   = b.codgestao
       AND s3.codmodulo   = b.codmodulo
       AND s3.idppsa_n2   = b.idppsa
     WHERE b.nivel = 2
),
n2_sums AS (
    SELECT cod_projeto,
           codgestao,
           codmodulo,
           idppsa_n1,
           SUM(eff_val) AS s2,
           SUM(eff_dias) AS s2_dias
      FROM n2_eff
     GROUP BY cod_projeto, codgestao, codmodulo, idppsa_n1
),
corrected_data AS (
    SELECT r.*,
           CASE
               WHEN r.nivel = 3 THEN NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0)
               WHEN r.nivel = 2 THEN NVL(n2_eff.eff_val,0)
               WHEN r.nivel = 1 THEN NVL(n2_sums.s2,
                                         NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0))
               ELSE NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0)
           END AS base_centesimal_corrigido,

           geral.hora_normal(
               CASE
                   WHEN r.nivel = 3 THEN NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0)
                   WHEN r.nivel = 2 THEN NVL(n2_eff.eff_val,0)
                   WHEN r.nivel = 1 THEN NVL(n2_sums.s2,
                                             NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0))
                   ELSE NVL(geral.hora_centesimal(NULLIF(r.base_total_hora_dias_programados, ':')),0)
               END
           ) AS total_hora_dias_programados,

           /*
              REALIZADO DA LINHA/HIERARQUIA:
              - sempre vem da arvore real IDPPSA -> ID_PAI;
              - N3 = apontamentos do ramo N3;
              - N2 = soma dos descendentes do N2;
              - N1 = soma dos descendentes do N1;
              - NAO usar este campo para totalizar o modulo somando niveis.
           */
           geral.hora_normal(NVL(rh.horas_realizadas,0)) AS horas_total_corrigida,

           /* Campos numericos/HH:MM explicitos para a API. */
           NVL(rd.horas_diretas,0) AS horas_realizadas_atomicas_decimal,
           geral.hora_normal(NVL(rd.horas_diretas,0)) AS horas_realizadas_atomicas_hhmm,
           NVL(rh.horas_realizadas,0) AS horas_realizadas_consolidadas_decimal,
           geral.hora_normal(NVL(rh.horas_realizadas,0)) AS horas_realizadas_consolidadas_hhmm,
           NVL(rm.horas_realizadas_modulo,0) AS horas_realizadas_modulo_decimal,
           geral.hora_normal(NVL(rm.horas_realizadas_modulo,0)) AS horas_realizadas_modulo_hhmm,

           CASE
               WHEN r.nivel = 3 THEN NVL(r.diff_dias_programada,0)
               WHEN r.nivel = 2 THEN NVL(n2_eff.eff_dias,0)
               WHEN r.nivel = 1 THEN NVL(n2_sums.s2_dias,NVL(r.diff_dias_programada,0))
               ELSE NVL(r.diff_dias_programada,0)
           END AS diff_dias_programada_corrigido
      FROM raw_data r
      LEFT JOIN n2_eff
        ON r.nivel = 2
       AND r.cod_projeto = n2_eff.cod_projeto
       AND r.codgestao   = n2_eff.codgestao
       AND r.codmodulo   = n2_eff.codmodulo
       AND r.idppsa      = n2_eff.idppsa
      LEFT JOIN n2_sums
        ON r.nivel = 1
       AND r.cod_projeto = n2_sums.cod_projeto
       AND r.codgestao   = n2_sums.codgestao
       AND r.codmodulo   = n2_sums.codmodulo
       AND r.idppsa      = n2_sums.idppsa_n1
      LEFT JOIN realizado_direto rd
        ON rd.cod_projeto = r.cod_projeto
       AND rd.codgestao   = r.codgestao
       AND rd.codmodulo   = r.codmodulo
       AND rd.idppsa      = r.idppsa
      LEFT JOIN realizado_hierarquia rh
        ON rh.cod_projeto = r.cod_projeto
       AND rh.codgestao   = r.codgestao
       AND rh.codmodulo   = r.codmodulo
       AND rh.idppsa      = r.idppsa
      LEFT JOIN realizado_modulo rm
        ON rm.cod_projeto = r.cod_projeto
       AND rm.codgestao   = r.codgestao
       AND rm.codmodulo   = r.codmodulo
),
calculated_data AS (SELECT tmp.*,
CASE
WHEN NVL(tmp.base_centesimal_corrigido,
0) = 0 THEN
0
ELSE
ROUND(NVL(geral.hora_centesimal(tmp.horas_total_corrigida),
0) /
tmp.base_centesimal_corrigido * 100,
2)
END AS perc_real,
CASE
WHEN NVL(tmp.base_centesimal_corrigido,
0) = 0 THEN
0
ELSE
LEAST(100,
ROUND(NVL(geral.hora_centesimal(tmp.horas_total_corrigida),
0) /
tmp.base_centesimal_corrigido * 100,
2))
END AS percentual_conclusao_bruto
FROM corrected_data tmp), final_data_base AS (SELECT c.*,
CASE
WHEN c.percentual_conclusao_bruto > 100 THEN
100
WHEN c.fim_realizado IS NOT NULL THEN
100
ELSE
NVL(c.percentual_conclusao_bruto,
0)
END AS percentual_conclusao_calc,
NVL(c.perc_real,
0) AS percentual_horas_realizada_original,
CASE
WHEN NVL(c.base_centesimal_corrigido,
0) = 0 AND
NVL(geral.hora_centesimal(c.horas_total_corrigida),
0) = 0 THEN
'SEM PROGRAMACAO'
WHEN c.perc_real > 100 THEN
'ESTOURO DE HORAS (' ||
TO_CHAR(c.perc_real,
'FM990D00') || '%)'
WHEN c.perc_real = 100 THEN
'REALIZADO CONFERE COM O PLANEJADO (100%)'
WHEN c.perc_real < 100 THEN
'SALDO DE HORAS (' ||
TO_CHAR(100 -
c.perc_real,
'FM990D00') || '%)'
ELSE
NULL
END AS status_estouro_horas
FROM calculated_data c), final_data_forced AS (SELECT f.*,
CASE
WHEN MAX(CASE
WHEN nivel = 1 AND
fim_realizado IS NOT NULL THEN
1
ELSE
0
END)
OVER(PARTITION BY
cod_projeto,
codgestao,
codmodulo,
projeto) = 1 THEN
1
WHEN nivel IN (2,
3) AND
MAX(CASE
WHEN nivel = 2 AND
fim_realizado IS NOT NULL THEN
1
ELSE
0
END)
OVER(PARTITION BY
cod_projeto,
codgestao,
codmodulo,
projeto,
processo) = 1 THEN
1
WHEN fim_realizado IS NOT NULL THEN
1
ELSE
0
END AS force_concluida
FROM final_data_base f), agg_n3 AS (SELECT cod_projeto,
codgestao,
codmodulo,
projeto,
processo,
SUM(percentual_conclusao_calc *
base_centesimal_corrigido) /
NULLIF(SUM(base_centesimal_corrigido),
0) AS perc_n2,
MIN(CASE
WHEN force_concluida = 1 OR
status_atividade =
'CONCLUIDA' THEN
1
ELSE
0
END) AS all_n3_concluida,
MAX(CASE
WHEN force_concluida = 1 OR
status_atividade IN
('EM ANDAMENTO',
'CONCLUIDA') THEN
1
ELSE
0
END) AS any_n3_started,
MAX(CASE
WHEN status_atividade =
'ATRASADA' AND
force_concluida = 0 THEN
1
ELSE
0
END) AS any_n3_atrasada
FROM final_data_forced
WHERE nivel = 3
GROUP BY cod_projeto,
codgestao,
codmodulo,
projeto,
processo), agg_n2 AS (SELECT f.cod_projeto,
f.codgestao,
f.codmodulo,
f.projeto,
SUM(NVL(a.perc_n2,
f.percentual_conclusao_calc) *
f.base_centesimal_corrigido) /
NULLIF(SUM(f.base_centesimal_corrigido),
0) AS perc_n1,
MIN(CASE
WHEN f.force_concluida = 1 THEN
1
WHEN a.cod_projeto IS NOT NULL THEN
a.all_n3_concluida
ELSE
CASE
WHEN f.status_atividade =
'CONCLUIDA' THEN
1
ELSE
0
END
END) AS all_n2_concluida,
MAX(CASE
WHEN f.force_concluida = 1 THEN
1
WHEN a.cod_projeto IS NOT NULL THEN
a.any_n3_started
ELSE
CASE
WHEN f.status_atividade IN
('EM ANDAMENTO',
'CONCLUIDA') THEN
1
ELSE
0
END
END) AS any_n2_started,
MAX(CASE
WHEN f.force_concluida = 1 THEN
0
WHEN a.cod_projeto IS NOT NULL THEN
a.any_n3_atrasada
ELSE
CASE
WHEN f.status_atividade =
'ATRASADA' THEN
1
ELSE
0
END
END) AS any_n2_atrasada
FROM final_data_forced f
LEFT JOIN agg_n3 a
ON f.cod_projeto =
a.cod_projeto
AND f.codgestao =
a.codgestao
AND f.codmodulo =
a.codmodulo
AND f.projeto =
a.projeto
AND f.processo =
a.processo
WHERE f.nivel = 2
GROUP BY f.cod_projeto,
f.codgestao,
f.codmodulo,
f.projeto), final_data AS (SELECT f.*,
ROUND(CASE
WHEN f.force_concluida = 1 THEN
100
WHEN f.nivel = 3 THEN
f.percentual_conclusao_calc
WHEN f.nivel = 2 THEN
NVL(a3.perc_n2,
f.percentual_conclusao_calc)
WHEN f.nivel = 1 THEN
NVL(a2.perc_n1,
f.percentual_conclusao_calc)
ELSE
f.percentual_conclusao_calc
END,
2) AS percentual_conclusao,
CASE
WHEN f.force_concluida = 1 THEN
'CONCLUIDA'
WHEN f.nivel = 3 THEN
f.status_atividade
WHEN f.nivel = 2 AND
a3.cod_projeto IS NOT NULL THEN
CASE
WHEN a3.all_n3_concluida = 1 THEN
'CONCLUIDA'
WHEN a3.any_n3_atrasada = 1 THEN
'ATRASADA'
WHEN a3.any_n3_started = 1 THEN
'EM ANDAMENTO'
ELSE
'NAO INICIADO'
END
WHEN f.nivel = 1 AND
a2.cod_projeto IS NOT NULL THEN
CASE
WHEN a2.all_n2_concluida = 1 THEN
'CONCLUIDA'
WHEN a2.any_n2_atrasada = 1 THEN
'ATRASADA'
WHEN a2.any_n2_started = 1 THEN
'EM ANDAMENTO'
ELSE
'NAO INICIADO'
END
ELSE
f.status_atividade
END AS status_atividade_corrigida
FROM final_data_forced f
LEFT JOIN agg_n3 a3
ON f.nivel = 2
AND f.cod_projeto =
a3.cod_projeto
AND f.codgestao =
a3.codgestao
AND f.codmodulo =
a3.codmodulo
AND f.projeto =
a3.projeto
AND f.processo =
a3.processo
LEFT JOIN agg_n2 a2
ON f.nivel = 1
AND f.cod_projeto =
a2.cod_projeto
AND f.codgestao =
a2.codgestao
AND f.codmodulo =
a2.codmodulo
AND f.projeto =
a2.projeto), final_data_with_flags AS (SELECT f.*,
CASE
WHEN (TRIM(REPLACE(:P_DATA_INI,
'''',
'')) IS NULL) OR
(NVL(:P_DATA_PREVISTA,
'N') = 'Y' AND
(TRUNC(f.inicio_programado) >= CASE
WHEN LOWER(TRIM(REPLACE(:P_DATA_INI,
'''',
''))) =
'sysdate' THEN
TRUNC(SYSDATE)
WHEN REPLACE(:P_DATA_INI,
'''',
'') LIKE
'%-%' THEN
TO_DATE(SUBSTR(TRIM(REPLACE(:P_DATA_INI,
'''',
'')),
1,
10),
'YYYY-MM-DD')
ELSE
TO_DATE(SUBSTR(TRIM(REPLACE(:P_DATA_INI,
'''',
'')),
1,
10),
'DD/MM/YYYY')
END)) OR
(NVL(:P_DATA_PREVISTA,
'N') != 'Y' AND
(TRUNC(f.inicio_realizado) >= CASE
WHEN LOWER(TRIM(REPLACE(:P_DATA_INI,
'''',
''))) =
'sysdate' THEN
TRUNC(SYSDATE)
WHEN REPLACE(:P_DATA_INI,
'''',
'') LIKE
'%-%' THEN
TO_DATE(SUBSTR(TRIM(REPLACE(:P_DATA_INI,
'''',
'')),
1,
10),
'YYYY-MM-DD')
ELSE
TO_DATE(SUBSTR(TRIM(REPLACE(:P_DATA_INI,
'''',
'')),
1,
10),
'DD/MM/YYYY')
END)) THEN
1
ELSE
0
END AS pass_date_filter
FROM final_data f), final_data_filtered AS (SELECT tmp.*,
MAX(CASE
WHEN tmp.nivel = 3 AND
tmp.pass_date_filter = 1 THEN
1
ELSE
0
END) OVER (PARTITION BY tmp.cod_projeto, tmp.codgestao, tmp.codmodulo, tmp.projeto, tmp.processo) AS has_n3_valid,
MAX(CASE
WHEN tmp.nivel >= 2 AND
tmp.pass_date_filter = 1 THEN
1
ELSE
0
END) OVER (PARTITION BY tmp.cod_projeto, tmp.codgestao, tmp.codmodulo, tmp.projeto) AS has_descendant_valid
FROM final_data_with_flags tmp),
fora_escopo AS (
    SELECT
        NULL AS idprojetocronograma,
        pm.id_projeto AS cod_projeto,
        ip.nome_projeto,
        ip.data_inicio AS projeto_data_inicio,
        ip.data_termino AS projeto_data_termino,
        ip.gestor_conta,
        usu.logon AS gestor_logon,
        usu.logon_email AS gestor_email,
        ip.projeto_encerrado,
        ip.data_escopo,
        ip.data_finalizacao_projeto,
        ip.responsavel_cliente,
        ip.hora_inicio_manha,
        ip.hora_termino_manha,
        ip.hora_inicio_tarde,
        ip.hora_termino_tarde,
        ip.email_responsavel AS email_responsavel_cliente,
        ip.id_segmento,
        ip.fase,
        ip.tipo_projeto,
        tip.descricao AS tipo_projeto_descricao,
        ip.cod_cliente,
        cli.cliente_nome,
        NULL AS idppsa,
        NULL AS codppsa,
        NULL AS descricao,
        NULL AS tempopadrao,
        NULL AS projeto,
        NULL AS processo,
        NULL AS subprocesso,
        NULL AS atividade,
        pm.data_inicio AS inicio_programado,
        pm.data_termino AS termino_programado,
        NVL(pm.qtd_semana_planejada, 0) * 5 AS diff_dias_programada,
        NULL AS recurso,
        NULL AS local,
        0 AS percentual_conclusao,
        pm.cod_gestao AS codgestao,
        g.descricao AS gestao_descricao,
        pm.cod_modulo AS codmodulo,
        m.descricao AS modulo_descricao,
        0 AS utilizacao_perc,
        0 AS utilizacao_perc_nivel,
        0 AS total_utilizacao_nivel,
        NULL AS nivel,
        NULL AS nivelfilho,
        NULL AS nivelpai,
        pm.qtd_semana_planejada,
        NVL(pm.qtd_semana_planejada, 0) * 40 AS horas_modulo_planejadas,
        geral.hora_normal(NVL(pm.qtd_semana_planejada, 0) * 40) AS total_hora_dias_programados,
        pm.data_inicio_realizado AS inicio_realizado,
        pm.data_termino_realizado AS fim_realizado,
        NULL AS percentual_dias_realizado,
        '0:00' AS horas_total,
        0 AS percentual_horas_realizada_original,
        NULL AS status_estouro_horas,
        CASE
            WHEN pm.data_termino_realizado IS NOT NULL THEN 'CONCLUIDA'
            WHEN pm.data_inicio_realizado IS NOT NULL THEN 'EM ANDAMENTO'
            WHEN pm.data_termino IS NOT NULL AND pm.data_termino < TRUNC(SYSDATE) THEN 'ATRASADA'
            ELSE 'NAO INICIADO'
        END AS status_atividade,
        pm.data_termino_realizado AS data_termino_realizado_modulo
    FROM segurancanovo.projetomodulo pm
    LEFT JOIN segurancanovo.implantacaoprojeto ip
      ON ip.codigo = pm.id_projeto
    LEFT JOIN cscv.cliente cli
      ON cli.cliente_codigo = ip.cod_cliente
    LEFT JOIN segurancanovo.usuario usu
      ON usu.id_logon = ip.gestor_conta
    LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
      ON tip.id_tipo_proj = ip.tipo_projeto
    LEFT JOIN segurancanovo.gestao g
      ON g.codgestao = pm.cod_gestao
    LEFT JOIN segurancanovo.modulo m
      ON m.codgestao = pm.cod_gestao
     AND m.codmodulo = pm.cod_modulo
    WHERE (NVL(:P_PROJETO, 0) = 0 OR pm.id_projeto = :P_PROJETO)
      AND (NVL(:P_GESTAO, 0) = 0 OR pm.cod_gestao = :P_GESTAO)
      AND (NVL(:P_MODULO, 0) = 0 OR pm.cod_modulo = :P_MODULO)
      AND NOT EXISTS (
          SELECT 1
          FROM segurancanovo.implantacao_projetocronograma ipc
          JOIN segurancanovo.implantacao_ppsa ppsa
            ON ppsa.idppsa = ipc.idppsa
          WHERE ipc.cod_projeto = pm.id_projeto
            AND ppsa.codgestao = pm.cod_gestao
            AND ppsa.codmodulo = pm.cod_modulo
      )
)
, resumo_modulo AS (
    SELECT pm.id_projeto AS cod_projeto,
           pm.cod_gestao AS codgestao,
           pm.cod_modulo AS codmodulo,
           MAX(NVL(pm.qtd_semana_planejada,0) * 40) AS horas_planejadas_modulo,
           MAX(NVL(rm.horas_realizadas_modulo,0)) AS horas_realizadas_modulo
      FROM segurancanovo.projetomodulo pm
      LEFT JOIN realizado_modulo rm
        ON rm.cod_projeto = pm.id_projeto
       AND rm.codgestao   = pm.cod_gestao
       AND rm.codmodulo   = pm.cod_modulo
     WHERE (NVL(:P_PROJETO,0) = 0 OR pm.id_projeto = :P_PROJETO)
       AND (NVL(:P_GESTAO,0) = 0 OR pm.cod_gestao = :P_GESTAO)
       AND (NVL(:P_MODULO,0) = 0 OR pm.cod_modulo = :P_MODULO)
     GROUP BY pm.id_projeto, pm.cod_gestao, pm.cod_modulo
),
resumo_gestao AS (
    SELECT cod_projeto,
           codgestao,
           SUM(horas_planejadas_modulo) AS horas_planejadas_gestao,
           SUM(horas_realizadas_modulo) AS horas_realizadas_gestao
      FROM resumo_modulo
     GROUP BY cod_projeto, codgestao
)
/* ============================================================================
   CONTRATO DE HORAS PARA A API (REV07)

   MODULO:
     HORAS_MODULO_PLANEJADAS_DECIMAL / _HHMM
     HORAS_REALIZADAS_MODULO_DECIMAL / _HHMM
     -> usar estes campos em cards, dashboards e totalizadores por modulo.

   LINHA/HIERARQUIA:
     HORAS_ATIVIDADE_PLANEJADAS_DECIMAL / _HHMM
     HORAS_REALIZADAS_ATOMICAS_DECIMAL / _HHMM
     HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL / _HHMM
     -> servem para arvore N1/N2/N3; nunca somar niveis diferentes juntos.

   COMPATIBILIDADE:
     TOTAL_HORA_DIAS_PROGRAMADOS = planejado consolidado da linha em HH:MM.
     HORAS_TOTAL = realizado consolidado da linha em HH:MM.

   REGRA DE OURO:
     total do modulo = campos *_MODULO, nunca SUM(N1 + N2 + N3).
   ============================================================================ */
SELECT tmp.idprojetocronograma,
tmp.cod_projeto,
tmp.nome_projeto,
tmp.projeto_data_inicio,
tmp.projeto_data_termino,
tmp.gestor_conta,
tmp.gestor_logon,
tmp.gestor_email,
tmp.projeto_encerrado,
tmp.data_escopo,
tmp.data_finalizacao_projeto,
tmp.responsavel_cliente,
tmp.hora_inicio_manha,
tmp.hora_termino_manha,
tmp.hora_inicio_tarde,
tmp.hora_termino_tarde,
tmp.email_responsavel_cliente,
tmp.id_segmento,
tmp.fase,
tmp.tipo_projeto,
tmp.tipo_projeto_descricao,
tmp.cod_cliente,
tmp.cliente_nome,
tmp.idppsa,
tmp.codppsa,
tmp.descricao,
tmp.tempopadrao,
tmp.projeto,
tmp.processo,
tmp.subprocesso,
tmp.atividade,
tmp.inicio_programado,
tmp.termino_programado,
ROUND(tmp.diff_dias_programada_corrigido, 2) AS diff_dias_programada,
tmp.recurso,
tmp.local,
tmp.percentual_conclusao,
tmp.codgestao,
tmp.gestao_descricao,
tmp.codmodulo,
tmp.modulo_descricao,
tmp.utilizacao_perc,
tmp.utilizacao_perc_nivel,
tmp.total_utilizacao_nivel,
tmp.nivel,
tmp.nivelfilho,
tmp.nivelpai,
CASE WHEN tmp.qtd_semana_planejada IS NOT NULL THEN ROUND(tmp.diff_dias_programada_corrigido / 5, 2) ELSE tmp.qtd_semana_planejada END AS qtd_semana_planejada,
tmp.horas_modulo_planejadas,
tmp.total_hora_dias_programados,
tmp.inicio_realizado,
tmp.fim_realizado,
tmp.percentual_dias_realizado,
NVL(tmp.horas_total_corrigida, '0:00') AS horas_total,
tmp.percentual_horas_realizada_original,
tmp.status_estouro_horas,
tmp.status_atividade_corrigida AS status_atividade,
tmp.data_termino_realizado_modulo,
'CRONOGRAMA' AS tipo_registro,
'S' AS possui_cronograma,
CASE
    WHEN tmp.nivelpai IS NOT NULL AND INSTR(tmp.nivelpai,'.') > 0
    THEN TO_NUMBER(SUBSTR(tmp.nivelpai,1,INSTR(tmp.nivelpai,'.')-1))
    ELSE NULL
END AS id_pai_ppsa,
NVL(tmp.horas_modulo_planejadas,0) AS horas_modulo_planejadas_decimal,
geral.hora_normal(NVL(tmp.horas_modulo_planejadas,0)) AS horas_modulo_planejadas_hhmm,
NVL(tmp.base_centesimal_corrigido,0) AS horas_atividade_planejadas_decimal,
NVL(tmp.total_hora_dias_programados,'0:00') AS horas_atividade_planejadas_hhmm,
NVL(tmp.horas_realizadas_atomicas_decimal,0) AS horas_realizadas_atomicas_decimal,
NVL(tmp.horas_realizadas_atomicas_hhmm,'0:00') AS horas_realizadas_atomicas_hhmm,
NVL(tmp.horas_realizadas_consolidadas_decimal,0) AS horas_realizadas_consolidadas_decimal,
NVL(tmp.horas_realizadas_consolidadas_hhmm,'0:00') AS horas_realizadas_consolidadas_hhmm,
NVL(tmp.horas_realizadas_modulo_decimal,0) AS horas_realizadas_modulo_decimal,
NVL(tmp.horas_realizadas_modulo_hhmm,'0:00') AS horas_realizadas_modulo_hhmm,
CASE
    WHEN NVL(tmp.horas_modulo_planejadas,0) = 0 THEN 0
    ELSE ROUND(NVL(tmp.horas_realizadas_modulo_decimal,0) / tmp.horas_modulo_planejadas * 100,2)
END AS percentual_horas_modulo_realizado,
CASE
    WHEN tmp.nivel = 1 THEN 'N1_CONSOLIDADO'
    WHEN tmp.nivel = 2 THEN 'N2_CONSOLIDADO'
    WHEN tmp.nivel = 3 THEN 'N3_DETALHADO'
    ELSE 'SEM_NIVEL'
END AS tipo_hora_linha,
'NAO_SOMAR_NIVEIS; PARA TOTAL DO MODULO USAR HORAS_*_MODULO' AS regra_totalizacao,
NVL(rm2.horas_planejadas_modulo,0) AS resumo_modulo_horas_planejadas_decimal,
geral.hora_normal(NVL(rm2.horas_planejadas_modulo,0)) AS resumo_modulo_horas_planejadas_hhmm,
NVL(rm2.horas_realizadas_modulo,0) AS resumo_modulo_horas_realizadas_decimal,
geral.hora_normal(NVL(rm2.horas_realizadas_modulo,0)) AS resumo_modulo_horas_realizadas_hhmm,
CASE WHEN NVL(rm2.horas_planejadas_modulo,0)=0 THEN 0
     ELSE ROUND(NVL(rm2.horas_realizadas_modulo,0)/rm2.horas_planejadas_modulo*100,2) END AS resumo_modulo_percentual_realizado,
NVL(rg.horas_planejadas_gestao,0) AS resumo_gestao_horas_planejadas_decimal,
geral.hora_normal(NVL(rg.horas_planejadas_gestao,0)) AS resumo_gestao_horas_planejadas_hhmm,
NVL(rg.horas_realizadas_gestao,0) AS resumo_gestao_horas_realizadas_decimal,
geral.hora_normal(NVL(rg.horas_realizadas_gestao,0)) AS resumo_gestao_horas_realizadas_hhmm,
CASE WHEN NVL(rg.horas_planejadas_gestao,0)=0 THEN 0
     ELSE ROUND(NVL(rg.horas_realizadas_gestao,0)/rg.horas_planejadas_gestao*100,2) END AS resumo_gestao_percentual_realizado
FROM final_data_filtered tmp
LEFT JOIN resumo_modulo rm2
  ON rm2.cod_projeto = tmp.cod_projeto
 AND rm2.codgestao   = tmp.codgestao
 AND rm2.codmodulo   = tmp.codmodulo
LEFT JOIN resumo_gestao rg
  ON rg.cod_projeto = tmp.cod_projeto
 AND rg.codgestao   = tmp.codgestao
WHERE (tmp.nivel = 1 OR
((NVL(:P_GESTAO, 0) = 0 OR tmp.codgestao = :P_GESTAO) AND
(NVL(:P_MODULO, 0) = 0 OR tmp.codmodulo = :P_MODULO)))
AND (NVL(:P_PROJETO, 0) = 0 OR tmp.cod_projeto = :P_PROJETO)
AND (tmp.pass_date_filter = 1 OR
(NVL(tmp.base_centesimal_corrigido, 0) = 0 AND
NVL(geral.hora_centesimal(tmp.horas_total_corrigida), 0) = 0) OR
(tmp.nivel = 2 AND tmp.has_n3_valid = 1) OR
(tmp.nivel = 1 AND tmp.has_descendant_valid = 1))
UNION ALL
SELECT fe.idprojetocronograma,
       fe.cod_projeto,
       fe.nome_projeto,
       fe.projeto_data_inicio,
       fe.projeto_data_termino,
       fe.gestor_conta,
       fe.gestor_logon,
       fe.gestor_email,
       fe.projeto_encerrado,
       fe.data_escopo,
       fe.data_finalizacao_projeto,
       fe.responsavel_cliente,
       fe.hora_inicio_manha,
       fe.hora_termino_manha,
       fe.hora_inicio_tarde,
       fe.hora_termino_tarde,
       fe.email_responsavel_cliente,
       fe.id_segmento,
       fe.fase,
       fe.tipo_projeto,
       fe.tipo_projeto_descricao,
       fe.cod_cliente,
       fe.cliente_nome,
       fe.idppsa,
       fe.codppsa,
       fe.descricao,
       fe.tempopadrao,
       fe.projeto,
       fe.processo,
       fe.subprocesso,
       fe.atividade,
       fe.inicio_programado,
       fe.termino_programado,
       fe.diff_dias_programada,
       fe.recurso,
       fe.local,
       fe.percentual_conclusao,
       fe.codgestao,
       fe.gestao_descricao,
       fe.codmodulo,
       fe.modulo_descricao,
       fe.utilizacao_perc,
       fe.utilizacao_perc_nivel,
       fe.total_utilizacao_nivel,
       fe.nivel,
       fe.nivelfilho,
       fe.nivelpai,
       fe.qtd_semana_planejada,
       fe.horas_modulo_planejadas,
       fe.total_hora_dias_programados,
       fe.inicio_realizado,
       fe.fim_realizado,
       fe.percentual_dias_realizado,
       fe.horas_total,
       fe.percentual_horas_realizada_original,
       fe.status_estouro_horas,
       fe.status_atividade,
       fe.data_termino_realizado_modulo,
       'FORA_ESCOPO' AS tipo_registro,
       'N' AS possui_cronograma,
       NULL AS id_pai_ppsa,
       NVL(fe.horas_modulo_planejadas,0) AS horas_modulo_planejadas_decimal,
       geral.hora_normal(NVL(fe.horas_modulo_planejadas,0)) AS horas_modulo_planejadas_hhmm,
       NULL AS horas_atividade_planejadas_decimal,
       NULL AS horas_atividade_planejadas_hhmm,
       0 AS horas_realizadas_atomicas_decimal,
       '0:00' AS horas_realizadas_atomicas_hhmm,
       0 AS horas_realizadas_consolidadas_decimal,
       '0:00' AS horas_realizadas_consolidadas_hhmm,
       NVL(rm.horas_realizadas_modulo,0) AS horas_realizadas_modulo_decimal,
       geral.hora_normal(NVL(rm.horas_realizadas_modulo,0)) AS horas_realizadas_modulo_hhmm,
       CASE
           WHEN NVL(fe.horas_modulo_planejadas,0) = 0 THEN 0
           ELSE ROUND(NVL(rm.horas_realizadas_modulo,0) / fe.horas_modulo_planejadas * 100,2)
       END AS percentual_horas_modulo_realizado,
       'MODULO_SEM_CRONOGRAMA' AS tipo_hora_linha,
       'PARA TOTAL DO MODULO USAR HORAS_*_MODULO' AS regra_totalizacao,
       NVL(rm2.horas_planejadas_modulo,0) AS resumo_modulo_horas_planejadas_decimal,
       geral.hora_normal(NVL(rm2.horas_planejadas_modulo,0)) AS resumo_modulo_horas_planejadas_hhmm,
       NVL(rm2.horas_realizadas_modulo,0) AS resumo_modulo_horas_realizadas_decimal,
       geral.hora_normal(NVL(rm2.horas_realizadas_modulo,0)) AS resumo_modulo_horas_realizadas_hhmm,
       CASE WHEN NVL(rm2.horas_planejadas_modulo,0)=0 THEN 0
            ELSE ROUND(NVL(rm2.horas_realizadas_modulo,0)/rm2.horas_planejadas_modulo*100,2) END AS resumo_modulo_percentual_realizado,
       NVL(rg.horas_planejadas_gestao,0) AS resumo_gestao_horas_planejadas_decimal,
       geral.hora_normal(NVL(rg.horas_planejadas_gestao,0)) AS resumo_gestao_horas_planejadas_hhmm,
       NVL(rg.horas_realizadas_gestao,0) AS resumo_gestao_horas_realizadas_decimal,
       geral.hora_normal(NVL(rg.horas_realizadas_gestao,0)) AS resumo_gestao_horas_realizadas_hhmm,
       CASE WHEN NVL(rg.horas_planejadas_gestao,0)=0 THEN 0
            ELSE ROUND(NVL(rg.horas_realizadas_gestao,0)/rg.horas_planejadas_gestao*100,2) END AS resumo_gestao_percentual_realizado
FROM fora_escopo fe
LEFT JOIN realizado_modulo rm
  ON rm.cod_projeto = fe.cod_projeto
 AND rm.codgestao   = fe.codgestao
 AND rm.codmodulo   = fe.codmodulo
LEFT JOIN resumo_modulo rm2
  ON rm2.cod_projeto = fe.cod_projeto
 AND rm2.codgestao   = fe.codgestao
 AND rm2.codmodulo   = fe.codmodulo
LEFT JOIN resumo_gestao rg
  ON rg.cod_projeto = fe.cod_projeto
 AND rg.codgestao   = fe.codgestao
ORDER BY codgestao,
         codmodulo,
         projeto,
         processo,
         subprocesso,
         atividade;
