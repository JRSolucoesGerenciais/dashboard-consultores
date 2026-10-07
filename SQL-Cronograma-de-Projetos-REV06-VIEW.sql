/*
  View de planejamento REV06 para a Gestão 360° CS Compusoftware.
  A View retorna todos os projetos. O filtro por projeto deve ser aplicado
  na consulta consumidora, por exemplo usando o código do projeto recebido.

  Regras preservadas da SQL recebida:
  - 40 horas por semana (5 dias x 8 horas);
  - rateio direto por UTILIZACAO_PERC limitado por MAX_UTILIZACAO;
  - consolidação PPSA N4 -> N3 -> N2 -> N1;
  - horas realizadas mantidas da origem.
  A View não classifica produtividade oficial; o aplicativo separa apenas
  vínculo ao cronograma (IDPROJETOCRONOGRAMA) para fins de escopo.
*/

CREATE OR REPLACE VIEW CSAGENDA_PLANEJAMENTO_REV06_VW AS
WITH cron_ppsa AS (
    /*
     * REV06 - PPSAs efetivamente usados no cronograma.
     * O percentual da IMPLANTACAO_PPSA e aplicado diretamente sobre
     * a capacidade do Projeto + Gestao + Modulo.
     *
     * IMPORTANTE:
     * - Nao normalizar percentuais.
     * - Nao distribuir somente para folhas.
     * - Os niveis pais serao consolidados posteriormente pela regra
     *   N4 -> N3 -> N2 -> N1 ja existente na SQL.
     */
    SELECT DISTINCT
           ipc.cod_projeto,
           p.idppsa,
           p.id_pai,
           p.codgestao,
           p.codmodulo,
           p.nivel,
           NVL(p.utilizacao_perc, 0) AS utilizacao_perc,
           NVL(p.max_utilizacao, NVL(p.utilizacao_perc, 0)) AS max_utilizacao,
           LEAST(
               NVL(p.utilizacao_perc, 0),
               NVL(p.max_utilizacao, NVL(p.utilizacao_perc, 0))
           ) AS percentual_efetivo
    FROM segurancanovo.implantacao_projetocronograma ipc
    JOIN segurancanovo.implantacao_ppsa p
      ON p.idppsa = ipc.idppsa
    WHERE p.nivel IN (1, 2, 3, 4)
),
capacidade_modulo AS (
    /*
     * REGRA OFICIAL DO PROGRAMADO:
     * 1 semana = 5 dias x 8 horas = 40 horas.
     *
     * Exemplo:
     * QTD_SEMANA_PLANEJADA = 1 -> 40 horas
     * QTD_SEMANA_PLANEJADA = 2 -> 80 horas
     * QTD_SEMANA_PLANEJADA = 6 -> 240 horas
     */
    SELECT pm.id_projeto,
           pm.cod_gestao,
           pm.cod_modulo,
           pm.qtd_semana_planejada,
           pm.data_inicio,
           pm.data_termino,
           NVL(pm.qtd_semana_planejada, 0) * 5 * 8 AS horas_maximas_modulo
    FROM segurancanovo.projetomodulo pm
    WHERE 1 = 1
),
planejamento_ppsa AS (
    /*
     * Cada PPSA recebe diretamente o percentual cadastrado para o modulo.
     * MAX_UTILIZACAO e o teto percentual da PPSA.
     *
     * Exemplo com modulo de 40h:
     * 50% -> 20h
     * 25% -> 10h
     * 1,25% -> 0,5h
     * 0,96% -> 0,384h
     */
    SELECT p.cod_projeto,
           p.idppsa,
           p.codgestao,
           p.codmodulo,
           p.nivel,
           p.utilizacao_perc,
           p.max_utilizacao,
           p.percentual_efetivo,
           c.horas_maximas_modulo,
           c.horas_maximas_modulo * p.percentual_efetivo / 100 AS horas_distribuidas
    FROM cron_ppsa p
    JOIN capacidade_modulo c
      ON c.id_projeto = p.cod_projeto
     AND c.cod_gestao = p.codgestao
     AND c.cod_modulo = p.codmodulo
),
modulo_com_rateio AS (
    SELECT DISTINCT cod_projeto, codgestao, codmodulo
    FROM planejamento_ppsa
),
raw_data AS (
                    SELECT x.idprojetocronograma,
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
                           NVL(x.diff_dias_programada, (pm.qtd_semana_planejada * 5)) AS diff_dias_programada,
                           x.recurso,
                           x.local,
                           x.codgestao,
                           ges.descricao AS gestao_descricao,
                           x.codmodulo,
                           modu.descricao AS modulo_descricao,
                           x.nivel,
                           x.nivelfilho,
                           x.nivelpai,
                           CASE
                              /*
                               * REGRA REV03 - PROGRAMADO
                               * Se houver programação por Projeto + Gestão + Módulo,
                               * TOTAL_HORA_DIAS_PROGRAMADOS passa a respeitar o teto
                               * da PROJETOMODULO e o rateio da IMPLANTACAO_PPSA.
                               * A parte REALIZADA permanece inalterada.
                               */
                              WHEN pp.idppsa IS NOT NULL THEN
                                   CASE
                                      WHEN NVL(pp.horas_distribuidas, 0) = 0 THEN '00:00'
                                      ELSE geral.hora_normal(pp.horas_distribuidas)
                                   END
                              WHEN pm.id_projetomod IS NOT NULL
                                   AND mr.cod_projeto IS NULL
                                   THEN '00:00'
                              WHEN x.total_hora_dias_programados = ':'
                                   OR x.total_hora_dias_programados IS NULL
                                   THEN '00:00'
                              ELSE x.total_hora_dias_programados
                           END AS base_total_hora_dias_programados,
                           NVL(pm.data_inicio_realizado, x.inicio_realizado) AS inicio_realizado,
                           pm.data_termino_realizado AS fim_realizado,
                           x.percentual_dias_realizado,
                           x.horas_total,
                           pm.qtd_semana_planejada,
                           CASE
                              WHEN pm.data_termino_realizado IS NOT NULL THEN 'CONCLUIDA'
                              WHEN NVL(pm.data_inicio_realizado, x.inicio_realizado) IS NOT NULL THEN 'EM ANDAMENTO'
                              WHEN pm.data_termino IS NOT NULL AND pm.data_termino < TRUNC(SYSDATE) THEN 'ATRASADA'
                              ELSE 'NAO INICIADO'
                           END AS status_atividade,
                           pm.data_termino_realizado AS data_termino_realizado_modulo
                    FROM(
                       SELECT idprojetocronograma,
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
                              nivel,
                              nivelfilho,
                              nivelpai,
                              total_hora_dias_programados,
                              inicio_realizado,
                              fim_realizado,
                              percentual_dias_realizado || '%' AS percentual_dias_realizado,
                              CASE
                                 WHEN geral.hora_normal(DECODE(nivel, 1, SUM(hora), SUM(horas_cem_apontada))) = ':' THEN NULL
                                 ELSE geral.hora_normal(DECODE(nivel, 1, SUM(hora), SUM(horas_cem_apontada)))
                              END AS horas_total
                       FROM (
                          SELECT tmp_base.idprojetocronograma,
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
                                 tmp_base.nivel,
                                 tmp_base.nivelfilho,
                                 tmp_base.nivelpai,
                                 geral.hora_normal((tmp_base.total_horas_programadas * tmp_base.diff_dias_programada)) AS total_hora_dias_programados,
                                 inicio_realizado,
                                 fim_realizado,
                                 (((csos.pkg_acomp_cs.fn_dias_uteis_hora(vdata1 => inicio_realizado,
                                                                         vdata2 => fim_realizado
                                                                        ) / 24
                                   ) + 1
                                  ) / tmp_base.diff_dias_programada
                                 ) * 100 AS percentual_dias_realizado,
                                 geral.hora_centesimal(NVL(NULLIF(tmp_horas_atividade.hora, ':'), '00:00')) AS horas_cem_apontada,
                                 tmp_calculo_rel.hora
                          FROM (
                          /* ---------- BASE: cronograma + ppsa + projeto ---------- */
                             SELECT ip.idprojetocronograma,
                                    ip.cod_projeto,
                                    ip.idppsa,
                                    ippsa.projeto || '.' || ippsa.processo || '.' ||
                                    ippsa.subprocesso || '.' || ippsa.atividade AS codppsa,
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
                                    ippsa.nivel,
                                    ippsa.idppsa || '.' || ippsa.nivel AS nivelfilho,
                                    DECODE(ippsa.nivel, 1, NULL,ippsa.id_pai || '.' || (ippsa.nivel - 1)) AS nivelpai,
                                    geral.hora_centesimal(NVL(NULLIF(TRIM(improj.hora_termino_manha), ':'), '00:00'))
                                  - geral.hora_centesimal(NVL(NULLIF(TRIM(improj.hora_inicio_manha), ':'), '00:00'))
                                  + geral.hora_centesimal(NVL(NULLIF(TRIM(improj.hora_termino_tarde), ':'), '00:00'))
                                  - geral.hora_centesimal(NVL(NULLIF(TRIM(improj.hora_inicio_tarde), ':'), '00:00')) AS total_horas_programadas
                             FROM   segurancanovo.implantacaoprojeto            improj,
                                    segurancanovo.implantacao_ppsa              ippsa,
                                    segurancanovo.implantacao_projetocronograma ip
                             WHERE  improj.codigo = ip.cod_projeto
                             AND    ippsa.nivel IN (1, 2, 3, 4)
                             AND    ippsa.idppsa = ip.idppsa
                         ) tmp_base
        LEFT JOIN (
            SELECT MIN(pro_rel.data_visita) AS inicio_realizado,
                   MAX(pro_rel.data_visita) AS fim_realizado,
                   imp_proj_cro.cod_projeto AS tmp_realizado_cod_projeto,
                   imp_proj_cro.idppsa      AS tmp_realizado_idppsa
            FROM   segurancanovo.processorelatorio            pro_rel,
                   segurancanovo.processorelatorio_atividades pro_ativ,
                   segurancanovo.implantacao_projetocronograma imp_proj_cro
            WHERE  pro_rel.id_processorelatorio = pro_ativ.id_processorelatorio
            AND    pro_rel.id_projeto = imp_proj_cro.cod_projeto
            AND    pro_ativ.idppsa    = imp_proj_cro.idppsa
            GROUP  BY imp_proj_cro.cod_projeto, imp_proj_cro.idppsa
        ) tmp_realizado
            ON tmp_base.cod_projeto = tmp_realizado.tmp_realizado_cod_projeto
           AND tmp_base.idppsa      = tmp_realizado.tmp_realizado_idppsa
        LEFT JOIN (
            SELECT geral.hora_normal(
                       SUM(
                           (TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahoratermino, 'dd/mm/rrrr hh24:mi')
                          - TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahorainicio, 'dd/mm/rrrr hh24:mi')) * 24
                       )
                   ) AS hora,
                   processorelatorio.id_projeto AS tmp_horas_projeto,
                   fam.idppsa                   AS tmp_horas_idppsa
            FROM   segurancanovo.processorelatoriohorarios    h,
                   segurancanovo.implantacao_projetocronograma cronograma,
                   segurancanovo.processorelatorio_atividades processo_atividades,
                   segurancanovo.processorelatorio            processorelatorio,
                   segurancanovo.implantacao_ppsa             base_ppsa,
                   segurancanovo.implantacao_ppsa             fam
            WHERE  h.id_procrel_atividade IN (processo_atividades.id_procrel_atividade)
            AND    cronograma.idprojetocronograma(+) = processo_atividades.id_projetocronograma
            AND    processo_atividades.id_processorelatorio = processorelatorio.id_processorelatorio
            AND    base_ppsa.idppsa = processo_atividades.idppsa
            AND    (fam.idppsa = base_ppsa.idppsa OR fam.idppsa = base_ppsa.id_pai)
            GROUP  BY processorelatorio.id_projeto, fam.idppsa
        ) tmp_horas_atividade
            ON tmp_base.cod_projeto = tmp_horas_atividade.tmp_horas_projeto
           AND tmp_base.idppsa      = tmp_horas_atividade.tmp_horas_idppsa
        LEFT JOIN (
            SELECT SUM(
                       (TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahoratermino, 'dd/mm/rrrr hh24:mi')
                      - TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahorainicio, 'dd/mm/rrrr hh24:mi')) * 24
                   ) AS hora,
                   processorelatorio.id_projeto AS id_projeto,
                   imp_ppsa.projeto             AS ppsa_projeto
            FROM   segurancanovo.implantacao_ppsa              imp_ppsa,
                   segurancanovo.processorelatoriohorarios     h,
                   segurancanovo.implantacao_projetocronograma cronograma,
                   segurancanovo.processorelatorio_atividades  processo_atividades,
                   segurancanovo.processorelatorio             processorelatorio
            WHERE  imp_ppsa.idppsa = processo_atividades.idppsa
            AND    h.id_procrel_atividade IN (processo_atividades.id_procrel_atividade)
            AND    cronograma.idprojetocronograma(+) = processo_atividades.id_projetocronograma
            AND    processo_atividades.id_processorelatorio = processorelatorio.id_processorelatorio
            GROUP  BY processorelatorio.id_projeto, imp_ppsa.projeto
        ) tmp_calculo_rel
            ON tmp_base.cod_projeto = tmp_calculo_rel.id_projeto
           AND tmp_base.projeto     = tmp_calculo_rel.ppsa_projeto
    )
    GROUP BY idprojetocronograma, cod_projeto, idppsa, codppsa, descricao,
             tempopadrao, atividade, processo, subprocesso, projeto,
             data_inicio_programada, data_termino_programada, diff_dias_programada,
             recurso, local, percentual_conclusao, data_inicio_realizada,
             data_termino_realizada, codgestao, codmodulo, nivel, nivelfilho,
             nivelpai, total_hora_dias_programados, inicio_realizado,
             fim_realizado, percentual_dias_realizado
    ) x
    LEFT JOIN planejamento_ppsa pp
           ON pp.cod_projeto = x.cod_projeto
          AND pp.idppsa      = x.idppsa
          AND pp.codgestao   = x.codgestao
          AND pp.codmodulo   = x.codmodulo
    LEFT JOIN modulo_com_rateio mr
           ON mr.cod_projeto = x.cod_projeto
          AND mr.codgestao   = x.codgestao
          AND mr.codmodulo   = x.codmodulo
    LEFT JOIN segurancanovo.projetomodulo pm
           ON x.cod_projeto = pm.id_projeto
          AND x.codgestao   = pm.cod_gestao
          AND x.codmodulo   = pm.cod_modulo
    LEFT JOIN segurancanovo.implantacaoprojeto ip
           ON ip.codigo = x.cod_projeto
    LEFT JOIN cscv.cliente cli
           ON cli.cliente_codigo = ip.cod_cliente
    LEFT JOIN segurancanovo.usuario usu
           ON usu.id_logon = ip.gestor_conta
    LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
           ON tip.id_tipo_proj = ip.tipo_projeto
    LEFT JOIN segurancanovo.gestao ges
           ON ges.codgestao = x.codgestao
    LEFT JOIN segurancanovo.modulo modu
           ON modu.codgestao = x.codgestao
          AND modu.codmodulo = x.codmodulo

    UNION ALL

    /* ============================================================
       BLOCO 2 - APONTAMENTOS SEM CRONOGRAMA
       ============================================================ */
    SELECT NULL                                     AS idprojetocronograma,
           horas_apont.cod_projeto                  AS cod_projeto,
           ip.nome_projeto,
           ip.data_inicio                           AS projeto_data_inicio,
           ip.data_termino                          AS projeto_data_termino,
           ip.gestor_conta,
           usu.logon               AS gestor_logon,
           usu.logon_email         AS gestor_email,
           ip.projeto_encerrado,
           ip.data_escopo,
           ip.data_finalizacao_projeto,
           ip.responsavel_cliente,
           ip.hora_inicio_manha,
           ip.hora_termino_manha,
           ip.hora_inicio_tarde,
           ip.hora_termino_tarde,
           ip.email_responsavel                     AS email_responsavel_cliente,
           ip.id_segmento,
           ip.fase,
           ip.tipo_projeto,
           tip.descricao          AS tipo_projeto_descricao,
           ip.cod_cliente,
           cli.cliente_nome,
           ppsa.idppsa,
           ppsa.projeto || '.' || ppsa.processo || '.' || ppsa.subprocesso || '.' || ppsa.atividade AS codppsa,
           ppsa.descricao,
           ppsa.tempopadrao,
           ppsa.projeto,
           ppsa.processo,
           ppsa.subprocesso,
           ppsa.atividade,
           NULL                                     AS inicio_programado,
           NULL                                     AS termino_programado,
           NULL                                     AS diff_dias_programada,
           NULL                                     AS recurso,
           NULL                                     AS local,
           ppsa.codgestao,
           ges.descricao          AS gestao_descricao,
           ppsa.codmodulo,
           modu.descricao         AS modulo_descricao,
           ppsa.nivel,
           ppsa.idppsa || '.' || ppsa.nivel          AS nivelfilho,
           DECODE(ppsa.nivel, 1, NULL, ppsa.id_pai || '.' || (ppsa.nivel - 1)) AS nivelpai,
           '0:00'                                   AS base_total_hora_dias_programados,
           NVL(pm.data_inicio_realizado, rel.data_visita)  AS inicio_realizado,
           pm.data_termino_realizado AS fim_realizado,
           NULL                                     AS percentual_dias_realizado,
           horas_apont.total_horas                  AS horas_total,
           NULL                                     AS qtd_semana_planejada,
           CASE
               WHEN pm.data_termino_realizado IS NOT NULL THEN 'CONCLUIDA'
               WHEN horas_apont.total_horas IS NOT NULL THEN 'EM ANDAMENTO'
               ELSE 'NAO INICIADO'
           END                                      AS status_atividade,
           pm.data_termino_realizado                AS data_termino_realizado_modulo
    FROM (
    /* Horas apontadas agrupadas por projeto + ppsa */
    SELECT pro_rel.id_projeto                             AS cod_projeto,
           NVL(base_ppsa.id_pai, base_ppsa.idppsa)        AS idppsa_agrup,
           base_ppsa.idppsa                               AS idppsa_original,
           geral.hora_normal(
               SUM(
                   (TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahoratermino, 'dd/mm/rrrr hh24:mi')
                  - TO_DATE(TO_CHAR(SYSDATE, 'dd/mm/rrrr') || h.datahorainicio, 'dd/mm/rrrr hh24:mi')) * 24
               )
           ) AS total_horas
    FROM   segurancanovo.processorelatoriohorarios    h,
           segurancanovo.processorelatorio_atividades pra,
           segurancanovo.processorelatorio            pro_rel,
           segurancanovo.implantacao_ppsa             base_ppsa
    WHERE  h.id_procrel_atividade IN (pra.id_procrel_atividade)
    AND    pra.id_processorelatorio = pro_rel.id_processorelatorio
    AND    base_ppsa.idppsa = pra.idppsa
    GROUP  BY pro_rel.id_projeto,
              NVL(base_ppsa.id_pai, base_ppsa.idppsa),
              base_ppsa.idppsa
) horas_apont
LEFT JOIN (
    /* Datas realizadas */
    SELECT pro_rel.id_projeto,
           pra.idppsa,
           MIN(pro_rel.data_visita) AS data_visita
    FROM   segurancanovo.processorelatorio            pro_rel,
           segurancanovo.processorelatorio_atividades pra
    WHERE  pro_rel.id_processorelatorio = pra.id_processorelatorio
    GROUP  BY pro_rel.id_projeto, pra.idppsa
) rel
       ON rel.id_projeto = horas_apont.cod_projeto
      AND rel.idppsa    = horas_apont.idppsa_original
LEFT JOIN segurancanovo.implantacao_ppsa ppsa
       ON ppsa.idppsa = horas_apont.idppsa_original
LEFT JOIN segurancanovo.implantacaoprojeto ip
       ON ip.codigo = horas_apont.cod_projeto
LEFT JOIN cscv.cliente cli
       ON cli.cliente_codigo = ip.cod_cliente
LEFT JOIN segurancanovo.usuario usu
       ON usu.id_logon = ip.gestor_conta
LEFT JOIN csweb.escritorio_projetos_tipo_proj tip
       ON tip.id_tipo_proj = ip.tipo_projeto
LEFT JOIN segurancanovo.gestao ges
       ON ges.codgestao = ppsa.codgestao
LEFT JOIN segurancanovo.modulo modu
       ON modu.codgestao = ppsa.codgestao
      AND modu.codmodulo = ppsa.codmodulo
LEFT JOIN segurancanovo.projetomodulo pm
       ON pm.id_projeto = horas_apont.cod_projeto
      AND pm.cod_gestao = ppsa.codgestao
      AND pm.cod_modulo = ppsa.codmodulo
WHERE  NOT EXISTS (
    SELECT 1
    FROM   segurancanovo.implantacao_projetocronograma ipc
    WHERE  ipc.cod_projeto = horas_apont.cod_projeto
    AND    ipc.idppsa      = horas_apont.idppsa_original
)
GROUP BY horas_apont.cod_projeto,
         ip.nome_projeto, ip.data_inicio, ip.data_termino, ip.gestor_conta,
         usu.logon, usu.logon_email, ip.projeto_encerrado, ip.data_escopo,
         ip.data_finalizacao_projeto, ip.responsavel_cliente,
         ip.hora_inicio_manha, ip.hora_termino_manha,
         ip.hora_inicio_tarde, ip.hora_termino_tarde,
         ip.email_responsavel, ip.id_segmento, ip.fase, ip.tipo_projeto,
         tip.descricao,
         ip.cod_cliente, cli.cliente_nome,
         ppsa.idppsa, ppsa.projeto, ppsa.processo, ppsa.subprocesso,
         ppsa.atividade, ppsa.descricao, ppsa.tempopadrao,
         ppsa.codgestao, ges.descricao,
         ppsa.codmodulo, modu.descricao,
         ppsa.nivel, ppsa.id_pai,
         horas_apont.total_horas,
         rel.data_visita,
         pm.data_inicio_realizado,
         pm.data_termino_realizado

),
n3_sums AS (
    SELECT cod_projeto, projeto, processo, 
           SUM(geral.hora_centesimal(base_total_hora_dias_programados)) as s3,
           SUM(diff_dias_programada) as s3_dias
    FROM raw_data
    WHERE nivel = 3
    GROUP BY cod_projeto, projeto, processo
),
n2_eff AS (
    SELECT b.cod_projeto, b.projeto, b.processo, 
           NVL(s3.s3, geral.hora_centesimal(b.base_total_hora_dias_programados)) as eff_val,
           NVL(s3.s3_dias, b.diff_dias_programada) as eff_dias
    FROM raw_data b
    LEFT JOIN n3_sums s3 ON b.cod_projeto = s3.cod_projeto AND b.projeto = s3.projeto AND b.processo = s3.processo
    WHERE b.nivel = 2
),
n2_sums AS (
    SELECT cod_projeto, projeto, 
           SUM(eff_val) as s2,
           SUM(eff_dias) as s2_dias
    FROM n2_eff
    GROUP BY cod_projeto, projeto
),
corrected_data AS (
    SELECT r.*,
           CASE 
               WHEN r.nivel = 3 THEN geral.hora_centesimal(r.base_total_hora_dias_programados)
               WHEN r.nivel = 2 THEN n2_eff.eff_val
               WHEN r.nivel = 1 THEN NVL(n2_sums.s2, geral.hora_centesimal(r.base_total_hora_dias_programados))
               ELSE geral.hora_centesimal(r.base_total_hora_dias_programados)
           END AS base_centesimal_corrigido,
           geral.hora_normal(
               CASE 
                   WHEN r.nivel = 3 THEN geral.hora_centesimal(r.base_total_hora_dias_programados)
                   WHEN r.nivel = 2 THEN n2_eff.eff_val
                   WHEN r.nivel = 1 THEN NVL(n2_sums.s2, geral.hora_centesimal(r.base_total_hora_dias_programados))
                   ELSE geral.hora_centesimal(r.base_total_hora_dias_programados)
               END
           ) AS total_hora_dias_programados,
           CASE 
               WHEN r.nivel = 3 THEN r.diff_dias_programada
               WHEN r.nivel = 2 THEN n2_eff.eff_dias
               WHEN r.nivel = 1 THEN NVL(n2_sums.s2_dias, r.diff_dias_programada)
               ELSE r.diff_dias_programada
           END AS diff_dias_programada_corrigido
    FROM raw_data r
    LEFT JOIN n2_eff ON r.nivel = 2 AND r.cod_projeto = n2_eff.cod_projeto AND r.projeto = n2_eff.projeto AND r.processo = n2_eff.processo
    LEFT JOIN n2_sums ON r.nivel = 1 AND r.cod_projeto = n2_sums.cod_projeto AND r.projeto = n2_sums.projeto
),
calculated_data AS (
    SELECT tmp.*,
           ROUND((geral.hora_centesimal(NVL(NULLIF(tmp.horas_total, ':'), '00:00')) / NULLIF(tmp.base_centesimal_corrigido, 0)) * 100, 2) AS perc_real,
           
           CASE
               WHEN tmp.base_total_hora_dias_programados = ':' AND tmp.qtd_semana_planejada IS NULL THEN NULL
               ELSE
                    LEAST(100, ROUND((geral.hora_centesimal(NVL(NULLIF(tmp.horas_total, ':'), '00:00')) / NULLIF(tmp.base_centesimal_corrigido, 0)) * 100, 2))
           END AS percentual_conclusao_bruto
    FROM corrected_data tmp
),
final_data_base AS (
    SELECT c.*,
           (CASE
               WHEN c.percentual_conclusao_bruto > 100 THEN 100
               WHEN c.fim_realizado IS NOT NULL THEN 100
               ELSE NVL(c.percentual_conclusao_bruto, 0)
           END) AS percentual_conclusao_calc,

           CASE
               WHEN c.base_total_hora_dias_programados = ':' AND c.qtd_semana_planejada IS NULL THEN NULL
               ELSE c.perc_real
           END AS percentual_horas_realizada_original,

           CASE
               WHEN c.base_total_hora_dias_programados = ':' AND c.qtd_semana_planejada IS NULL THEN NULL
               WHEN c.perc_real > 100 THEN 'ESTOURO DE HORAS (' || TO_CHAR(c.perc_real, 'FM990D00') || '%)'
               WHEN c.perc_real = 100 THEN 'REALIZADO CONFERE COM O PLANEJADO (100%)'
               WHEN c.perc_real < 100 THEN 'SALDO DE HORAS (' || TO_CHAR(100 - c.perc_real, 'FM990D00') || '%)'
               ELSE NULL
           END AS status_estouro_horas
    FROM calculated_data c
),
final_data_forced AS (
    SELECT f.*,
           CASE 
               WHEN MAX(CASE WHEN nivel = 1 AND fim_realizado IS NOT NULL THEN 1 ELSE 0 END) OVER (PARTITION BY cod_projeto, codgestao, codmodulo, projeto) = 1 THEN 1
               WHEN nivel IN (2, 3) AND MAX(CASE WHEN nivel = 2 AND fim_realizado IS NOT NULL THEN 1 ELSE 0 END) OVER (PARTITION BY cod_projeto, codgestao, codmodulo, projeto, processo) = 1 THEN 1
               WHEN fim_realizado IS NOT NULL THEN 1
               ELSE 0
           END AS force_concluida
    FROM final_data_base f
),
agg_n3 AS (
    SELECT cod_projeto, codgestao, codmodulo, projeto, processo,
           SUM(percentual_conclusao_calc * base_centesimal_corrigido) / NULLIF(SUM(base_centesimal_corrigido), 0) AS perc_n2,
           MIN(CASE WHEN force_concluida = 1 OR status_atividade = 'CONCLUIDA' THEN 1 ELSE 0 END) AS all_n3_concluida,
           MAX(CASE WHEN force_concluida = 1 OR status_atividade IN ('EM ANDAMENTO', 'CONCLUIDA') THEN 1 ELSE 0 END) AS any_n3_started,
           MAX(CASE WHEN status_atividade = 'ATRASADA' AND force_concluida = 0 THEN 1 ELSE 0 END) AS any_n3_atrasada
    FROM final_data_forced
    WHERE nivel = 3
    GROUP BY cod_projeto, codgestao, codmodulo, projeto, processo
),
agg_n2 AS (
    SELECT f.cod_projeto, f.codgestao, f.codmodulo, f.projeto,
           SUM( NVL(a.perc_n2, f.percentual_conclusao_calc) * f.base_centesimal_corrigido ) / NULLIF(SUM(f.base_centesimal_corrigido), 0) AS perc_n1,
           MIN(CASE 
                 WHEN f.force_concluida = 1 THEN 1
                 WHEN a.cod_projeto IS NOT NULL THEN a.all_n3_concluida
                 ELSE CASE WHEN f.status_atividade = 'CONCLUIDA' THEN 1 ELSE 0 END
               END) AS all_n2_concluida,
           MAX(CASE 
                 WHEN f.force_concluida = 1 THEN 1
                 WHEN a.cod_projeto IS NOT NULL THEN a.any_n3_started
                 ELSE CASE WHEN f.status_atividade IN ('EM ANDAMENTO', 'CONCLUIDA') THEN 1 ELSE 0 END
               END) AS any_n2_started,
           MAX(CASE 
                 WHEN f.force_concluida = 1 THEN 0
                 WHEN a.cod_projeto IS NOT NULL THEN a.any_n3_atrasada
                 ELSE CASE WHEN f.status_atividade = 'ATRASADA' THEN 1 ELSE 0 END
               END) AS any_n2_atrasada
    FROM final_data_forced f
    LEFT JOIN agg_n3 a ON f.cod_projeto = a.cod_projeto AND f.codgestao = a.codgestao AND f.codmodulo = a.codmodulo AND f.projeto = a.projeto AND f.processo = a.processo
    WHERE f.nivel = 2
    GROUP BY f.cod_projeto, f.codgestao, f.codmodulo, f.projeto
),
final_data AS (
    SELECT f.*,
           ROUND(CASE 
               WHEN f.force_concluida = 1 THEN 100
               WHEN f.nivel = 3 THEN f.percentual_conclusao_calc
               WHEN f.nivel = 2 THEN NVL(a3.perc_n2, f.percentual_conclusao_calc)
               WHEN f.nivel = 1 THEN NVL(a2.perc_n1, f.percentual_conclusao_calc)
               ELSE f.percentual_conclusao_calc
           END, 2) AS percentual_conclusao,
           
           CASE 
               WHEN f.force_concluida = 1 THEN 'CONCLUIDA'
               WHEN f.nivel = 3 THEN f.status_atividade
               WHEN f.nivel = 2 AND a3.cod_projeto IS NOT NULL THEN
                   CASE 
                       WHEN a3.all_n3_concluida = 1 THEN 'CONCLUIDA'
                       WHEN a3.any_n3_atrasada = 1 THEN 'ATRASADA'
                       WHEN a3.any_n3_started = 1 THEN 'EM ANDAMENTO'
                       ELSE 'NAO INICIADO'
                   END
               WHEN f.nivel = 1 AND a2.cod_projeto IS NOT NULL THEN
                   CASE 
                       WHEN a2.all_n2_concluida = 1 THEN 'CONCLUIDA'
                       WHEN a2.any_n2_atrasada = 1 THEN 'ATRASADA'
                       WHEN a2.any_n2_started = 1 THEN 'EM ANDAMENTO'
                       ELSE 'NAO INICIADO'
                   END
               ELSE f.status_atividade
           END AS status_atividade_corrigida
    FROM final_data_forced f
    LEFT JOIN agg_n3 a3 ON f.nivel = 2 AND f.cod_projeto = a3.cod_projeto AND f.codgestao = a3.codgestao AND f.codmodulo = a3.codmodulo AND f.projeto = a3.projeto AND f.processo = a3.processo
    LEFT JOIN agg_n2 a2 ON f.nivel = 1 AND f.cod_projeto = a2.cod_projeto AND f.codgestao = a2.codgestao AND f.codmodulo = a2.codmodulo AND f.projeto = a2.projeto
),
final_data_with_flags AS (
    SELECT f.*,
           CASE WHEN (
               (trim(REPLACE('01/01/2024', '''', '')) is null)
               or
               (NVL('N', 'N') = 'Y' and (trunc(f.inicio_programado) >= CASE WHEN LOWER(TRIM(REPLACE('01/01/2024', '''', ''))) = 'sysdate' THEN TRUNC(SYSDATE) WHEN REPLACE('01/01/2024', '''', '') LIKE '%-%' THEN TO_DATE(SUBSTR(TRIM(REPLACE('01/01/2024', '''', '')), 1, 10), 'YYYY-MM-DD') ELSE TO_DATE(SUBSTR(TRIM(REPLACE('01/01/2024', '''', '')), 1, 10), 'DD/MM/YYYY') END))
               or
               (NVL('N', 'N') != 'Y' and (trunc(f.inicio_realizado) >= CASE WHEN LOWER(TRIM(REPLACE('01/01/2024', '''', ''))) = 'sysdate' THEN TRUNC(SYSDATE) WHEN REPLACE('01/01/2024', '''', '') LIKE '%-%' THEN TO_DATE(SUBSTR(TRIM(REPLACE('01/01/2024', '''', '')), 1, 10), 'YYYY-MM-DD') ELSE TO_DATE(SUBSTR(TRIM(REPLACE('01/01/2024', '''', '')), 1, 10), 'DD/MM/YYYY') END))
           ) THEN 1 ELSE 0 END as pass_date_filter
    FROM final_data f
),
final_data_filtered AS (
    SELECT tmp.*,
           MAX(case when tmp.nivel = 3 and tmp.pass_date_filter = 1 then 1 else 0 end) OVER (PARTITION BY tmp.cod_projeto, tmp.codgestao, tmp.codmodulo, tmp.projeto) as has_n3_valid,
           MAX(case when tmp.nivel >= 2 and tmp.pass_date_filter = 1 then 1 else 0 end) OVER (PARTITION BY tmp.cod_projeto, tmp.codgestao) as has_descendant_valid
    FROM final_data_with_flags tmp
)
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
       tmp.diff_dias_programada_corrigido AS diff_dias_programada,
       tmp.recurso,
       tmp.local,
       tmp.percentual_conclusao,
       tmp.codgestao,
       tmp.gestao_descricao,
       tmp.codmodulo,
       tmp.modulo_descricao,
       tmp.nivel,
       tmp.nivelfilho,
       tmp.nivelpai,
       tmp.total_hora_dias_programados,
       tmp.inicio_realizado,
       tmp.fim_realizado,
       tmp.percentual_dias_realizado,
       tmp.horas_total,
       tmp.percentual_horas_realizada_original,
       tmp.status_estouro_horas,
       tmp.status_atividade_corrigida as status_atividade,
       tmp.data_termino_realizado_modulo

FROM final_data_filtered tmp
WHERE 1 = 1;