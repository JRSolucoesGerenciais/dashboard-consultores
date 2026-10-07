# Auditoria da SQL Rev03 no endpoint CSAgenda — 01/10/2026

## Fonte consultada

- Endpoint: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2`
- Consulta realizada sem importar dados para a base.
- HTTP retornado: `200`.
- Contrato de colunas Rev03 presente: `QTD_SEMANA_PLANEJADA`, `HORAS_PLANEJADAS_MODULO`, `HORAS_PRODUTIVAS_REALIZADAS`, `HORAS_IMPRODUTIVAS_REALIZADAS`, `ESCOPO_PLANEJAMENTO` e `BASE_TOTAL_HORA_DIAS_PROGRAMADOS`.

## Resultado da prévia atual

| Indicador | Resultado |
|---|---:|
| Registros retornados | 387 |
| Projetos retornados | 65 |
| Projetos na base atual | 323 |
| Cobertura | 20,1% |
| Projetos ausentes | 258 |
| Níveis recebidos | somente Nível 1 |
| Publicação permitida | Não |

A SQL foi reconhecida como Rev03 pelas colunas, mas não foi considerada válida para importação porque a cobertura está muito abaixo da base e o Projeto Majaguas não reconcilia com a referência operacional.

## Projeto Majaguas — código 122

### Referência esperada no sistema CSAgenda

| Indicador | Esperado |
|---|---:|
| Planejado no cronograma | 5.960,0 h |
| Planejado fora do cronograma | 1.000,0 h |
| Total planejado | 6.960,0 h |
| Produtivas realizadas | 4.391,1 h |
| Improdutivas realizadas | 2.197,2 h |

### O que a nova resposta da API trouxe

| Indicador | API atual | Diferença |
|---|---:|---:|
| Planejado no cronograma | 1.880,0 h | -4.080,0 h |
| Planejado fora do cronograma | 1.000,0 h | 0,0 h |
| Total planejado | 2.880,0 h | -4.080,0 h |
| Produtivas realizadas | 4.142,2 h | -248,9 h |
| Improdutivas realizadas | 250,9 h | -1.946,3 h |

A resposta trouxe 22 registros para o projeto 122, todos Nível 1. Não vieram os Níveis 2 e 3 que existiam no payload anterior; portanto a hierarquia PPSA não consegue reconstruir as 5.960,0 h do cronograma.

### Gestão/Módulo recebido no Projeto 122

As horas `HORAS_PLANEJADAS_MODULO` vieram como semanas × 5 × 8 e totalizaram:

- Cronograma: 1.880,0 h.
- Fora do cronograma: 1.000,0 h.
- Total por Gestão/Módulo: 2.880,0 h.

Os campos `HORAS_PRODUTIVAS_REALIZADAS` e `HORAS_IMPRODUTIVAS_REALIZADAS` aparecem repetidos nas linhas do projeto e foram deduplicados por projeto, conforme a regra da aplicação. Mesmo deduplicando, os valores ainda não batem com a referência.

## Diagnóstico técnico

1. **A cobertura da consulta mudou:** 65 projetos de 323, contra aproximadamente 267 projetos e mais de 10 mil registros no payload anterior.
2. **A hierarquia foi reduzida na saída:** a resposta atual contém somente Nível 1 para o projeto 122. O SQL pode estar com filtro de nível, parâmetro de projeto/escopo ou bind sendo aplicado no endpoint.
3. **A fórmula de produtividade não reproduz o sistema:** a SQL Rev03 local classifica apontamento com `idprojetocronograma` como produtivo e sem vínculo como improdutivo. Essa classificação gera 4.142,2 h / 250,9 h, não 4.391,1 h / 2.197,2 h. O campo de classificação usado pelo CSAgenda precisa ser confirmado na origem.
4. **A fórmula de planejamento por módulo também não reproduz o cronograma:** `qtd_semana_planejada × 5 × 8` gera 1.880,0 h no cronograma para o projeto 122; a referência usa 5.960,0 h. O campo oficial de horas do módulo ou a regra de conversão precisa ser o mesmo usado pela tela do CSAgenda.
5. **Não é seguro importar esta prévia:** a aplicação agora mostra “SQL Rev03 — Bloqueada” e impede o botão de publicação. Nenhum dado foi gravado por esta auditoria.

## Correção implementada na aplicação

- A prévia agora calcula cobertura da base e compara o Projeto 122 com a referência.
- Uma SQL só é considerada importável se tiver o contrato Rev03, cobertura mínima e reconciliação da referência Majaguas.
- O staging guarda a validação; o backend bloqueia também uma chamada de publicação feita fora da tela.
- O botão continua disponível apenas para testar a conexão, mas “Importar dados da prévia” fica bloqueado até a nova SQL retornar os dados corretos.
- Acumulados de período foram limitados ao total canônico do projeto para nunca exibir mais horas no período do que no total.

## Próximo ajuste necessário no Oracle/CSAgenda

Publicar uma nova versão do SELECT que:

- Retorne todos os projetos esperados, não somente 65.
- Retorne a hierarquia PPSA necessária para a análise (Níveis 1, 2 e 3 quando existirem), sem filtrar a saída somente para Nível 1.
- Exponha o campo/regra real usado pelo CSAgenda para separar produtivas e improdutivas.
- Exponha o valor de horas planejadas por Gestão/Módulo usado na tela CSAgenda, sem substituir por uma conversão aproximada de semanas.
- Mantenha `ESCOPO_PLANEJAMENTO`, `QTD_SEMANA_PLANEJADA` e `HORAS_PLANEJADAS_MODULO` para a reconciliação e deduplicação.
