# Auditoria do Projeto Majaguas #122 — retorno bruto da API (01/10/2026)

## Fonte
Endpoint CSAgenda configurado no sistema: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2`.
Snapshot local analisado: `/tmp/csagenda-live-20261001.bin`.

## Retorno bruto observado
O snapshot contém 10.208 linhas e 368 linhas do projeto 122. O contrato retornado é o da SQL anterior: `IDPROJETOCRONOGRAMA`, `CODPPSA`, `NIVEL`, `DIFF_DIAS_PROGRAMADA`, `TOTAL_HORA_DIAS_PROGRAMADOS`, `HORAS_TOTAL`, Gestão e Módulo. Não há `HORAS_PLANEJADAS_MODULO`, `HORAS_PRODUTIVAS_REALIZADAS`, `HORAS_IMPRODUTIVAS_REALIZADAS` ou `ESCOPO_PLANEJAMENTO`.

No projeto 122 há 12 PPSAs Nível 1. O campo fonte usa jornada de 10 horas/dia: `TOTAL_HORA_DIAS_PROGRAMADOS = DIFF_DIAS_PROGRAMADA × 10`.

| PPSA N1 | Gestão/Módulo | Dias | Horas fonte | Horas realizadas |
|---|---|---:|---:|---:|
| 11.0.0.0 | Agrícola / Controle de Colheita | 1049 | 10.490,0 | 773,2 |
| 5.0.0.0 | Material / Informações Gerais | 645 | 6.450,0 | 538,8 |
| 9.0.0.0 | Contabilidade Fiscal / Contabilidade | 337 | 3.370,0 | 90,0 |
| 10.0.0.0 | Contabilidade Gerencial / Custo | 95 | 950,0 | 0,0 |
| 6.0.0.0 | Financeira / Contas a Pagar | 3752 | 37.520,0 | 179,1 |
| 12.0.0.0 | Automotiva / Manutenção Automotiva | 1601 | 16.010,0 | 208,6 |
| 7.0.0.0 | Comercial / Informações Gerais | 2501 | 25.010,0 | 383,6 |
| 13.0.0.0 | Industrial / Manutenção Industrial | 1553 | 15.530,0 | 1.374,8 |
| 2.0.0.0 | Escritório de Projetos / Implantação | 925 | 9.250,0 | 0,0 |
| 3.0.0.0 | Escritório de Projetos / Implantação | 924 | 9.240,0 | 22,5 |
| 1.0.0.0 | Servidores / Servidores | 282 | 2.820,0 | 0,0 |
| 18.0.0.0 | Geral / Ged | 631 | 6.310,0 | 0,0 |

Total Nível 1 canônico observado: 142.950,0 h planejadas e 3.572,7 h realizadas (o banco persistido após a importação mostra 3.572,7 h).

## Referência gerencial anterior do sistema
A referência que o usuário quer recuperar para o Majaguas é: 5.960,0 h no cronograma; 1.000,0 h fora do cronograma; 6.960,0 h total planejado; 4.391,1 h produtivas realizadas; 2.197,2 h improdutivas realizadas; 63,1%.

## Conclusão
Os quatro números da referência não estão disponíveis no retorno bruto da SQL anterior. A aplicação deve preservar o payload bruto e aplicar uma regra interna explicitamente configurada/derivada. Não se deve simplesmente usar `TOTAL_HORA_DIAS_PROGRAMADOS` como total gerencial, pois isso produz 142.950,0 h devido à jornada de 10 h/dia e não reproduz a referência 6.960,0 h. A regra interna precisa ser validada antes de ser generalizada a todos os projetos.
