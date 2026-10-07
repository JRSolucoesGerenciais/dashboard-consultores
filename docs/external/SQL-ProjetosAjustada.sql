SELECT x.idprojetocronograma,
       x.cod_projeto,
       x.idppsa,
       x.codppsa,
       x.descricao,
       x.tempopadrao,
       x.projeto,
       x.processo,
       x.subprocesso,
       x.atividade,
       pm.data_inicio                AS inicio_programado,
       pm.data_termino               AS termino_programado,
       NVL(x.diff_dias_programada, (pm.qtd_semana_planejada * 5)) AS diff_dias_programada,
       x.recurso,
       x.local,
       x.percentual_conclusao,
       x.codgestao,
       x.codmodulo,
       x.nivel,
       x.nivelfilho,
       x.nivelpai,
       CASE
           WHEN x.total_hora_dias_programados = ':' AND pm.qtd_semana_planejada IS NOT NULL THEN
                TO_CHAR((pm.qtd_semana_planejada * 5) * 8) || ':00'
           ELSE x.total_hora_dias_programados
       END                           AS total_hora_dias_programados,
       x.inicio_realizado,
       x.fim_realizado,
       x.percentual_dias_realizado,
       x.horas_total,
       CASE
           WHEN x.total_hora_dias_programados = ':' AND pm.qtd_semana_planejada IS NULL THEN
                ''
           ELSE
                TO_CHAR(
                    (SELECT ROUND(
                        (geral.hora_centesimal(x.horas_total) /
                         geral.hora_centesimal(
                             CASE
                                 WHEN x.total_hora_dias_programados = ':' AND pm.qtd_semana_planejada IS NOT NULL
                                     THEN TO_CHAR((pm.qtd_semana_planejada * 5) * 8) || ':00'
                                 ELSE x.total_hora_dias_programados
                             END
                         )) * 100, 2)
                     FROM dual
                    )
                ) || '%'
       END                           AS percentual_horas_realizada,
       CASE
           WHEN x.nivel = 1 THEN x.percentual_dias_realizado
           ELSE '-'
       END                           AS percentual_dias_realizado_2
FROM (
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
               WHEN geral.hora_normal(
                        DECODE(nivel, 1, SUM(hora), SUM(horas_cem_apontada))
                    ) = ':'
                   THEN NULL
               ELSE geral.hora_normal(
                        DECODE(nivel, 1, SUM(hora), SUM(horas_cem_apontada))
                    )
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
               geral.hora_normal(
                   (tmp_base.total_horas_programadas * tmp_base.diff_dias_programada)
               ) AS total_hora_dias_programados,
               inicio_realizado,
               fim_realizado,
               (
                   (
                       (csos.pkg_acomp_cs.fn_dias_uteis_hora(
                            vdata1 => inicio_realizado,
                            vdata2 => fim_realizado
                        ) / 24
                       ) + 1
                   ) / tmp_base.diff_dias_programada
               ) * 100 AS percentual_dias_realizado,
               geral.hora_centesimal(tmp_horas_atividade.hora) AS horas_cem_apontada,
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
                   (csos.pkg_acomp_cs.fn_dias_uteis_hora(
                        vdata1 => ip.data_inicio_programada,
                        vdata2 => ip.data_termino_programada
                    ) / 24) + 1 AS diff_dias_programada,
                   ip.recurso,
                   ip.local,
                   ip.percentual_conclusao,
                   ip.data_inicio_realizada,
                   ip.data_termino_realizada,
                   ippsa.codgestao,
                   ippsa.codmodulo,
                   ippsa.nivel,
                   ippsa.idppsa || '.' || ippsa.nivel AS nivelfilho,
                   DECODE(ippsa.nivel, 1, NULL,
                          ippsa.id_pai || '.' || (ippsa.nivel - 1)) AS nivelpai,
                   geral.hora_centesimal(improj.hora_termino_manha)
                 - geral.hora_centesimal(improj.hora_inicio_manha)
                 + geral.hora_centesimal(improj.hora_termino_tarde)
                 - geral.hora_centesimal(improj.hora_inicio_tarde) AS total_horas_programadas
            FROM   segurancanovo.implantacaoprojeto            improj,
                   segurancanovo.implantacao_ppsa              ippsa,
                   segurancanovo.implantacao_projetocronograma ip
            WHERE  improj.codigo = ip.cod_projeto
            AND    ippsa.nivel IN (1, 2, 3)
            AND    ippsa.idppsa = ip.idppsa
            /* >>> FILTRO MULTI-PROJETOS <<< */
            AND    ip.cod_projeto IN (
                       SELECT column_value
                       FROM   TABLE(apex_string.split(:P200_COD_PROJETO, ':'))
                   )
        ) tmp_base

        /* ---------- Datas realizadas ---------- */
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

        /* ---------- Horas apontadas por atividade ---------- */
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

        /* ---------- Cálculo relatório ---------- */
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
    ORDER BY idppsa
) x
LEFT JOIN segurancanovo.projetomodulo pm
       ON x.cod_projeto = pm.id_projeto
      AND x.codgestao   = pm.cod_gestao
      AND x.codmodulo   = pm.cod_modulo
ORDER BY x.cod_projeto, x.idppsa