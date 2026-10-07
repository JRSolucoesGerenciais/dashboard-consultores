# Relatório de reconciliação — Projeto Majaguas #122

**Data da consulta:** 02/10/2026 (BRT)

## Resultado do endpoint atual

- **HTTP:** 200
- **Registros recebidos:** 23.722
- **Projetos recebidos:** 322
- **Linhas do projeto #122:** 368
- **Níveis presentes no #122:** 1, 2 e 3
- **Nível 4 presente no #122:** não

## Comparação do #122

| Indicador | Valor esperado no sistema | Valor retornado pela API atual | Diferença |
|---|---:|---:|---:|
| Planejadas total | 6.960,0 h | 5.605,7 h (Nível 1) | -1.354,3 h |
| Planejadas no cronograma | 5.960,0 h | 5.605,7 h | -354,3 h |
| Planejadas fora do cronograma | 1.000,0 h | 0,0 h | -1.000,0 h |
| Produtivas realizadas | 4.391,1 h | 3.572,7 h (Nível 1) | -818,4 h |
| Improdutivas realizadas | 2.197,2 h | Não informado | Não calculável |

## Evidência do contrato retornado

A API atual retorna `TOTAL_HORA_DIAS_PROGRAMADOS`, `HORAS_TOTAL`, `PERCENTUAL_HORAS_REALIZADA_ORIGINAL` e `STATUS_ESTOURO_HORAS`, mas **não retorna**:

- `HORAS_PRODUTIVAS_REALIZADAS`
- `HORAS_IMPRODUTIVAS_REALIZADAS`
- `HORAS_PLANEJADAS_MODULO`
- `ESCOPO_PLANEJAMENTO`

Portanto, não é tecnicamente possível reconstruir 4.391,1 h produtivas e 2.197,2 h improdutivas a partir desse payload sem inventar uma regra. Horas fora do cronograma não equivalem automaticamente a horas improdutivas.

## Níveis PPSA

O retorno atual possui níveis na base geral, mas o Majaguas #122 não possui Nível 4. A DDL versionada da View foi ajustada para aceitar `NIVEL IN (1, 2, 3, 4)`. A tela Gestão/Módulo também foi ajustada para exibir linhas separadas por nível, sem somar N1 + N2 + N3 + N4.

## Proteção aplicada

A prévia da aplicação agora compara o projeto #122 com a referência validada:

- 6.960,0 h planejadas;
- 5.960,0 h no cronograma;
- 1.000,0 h fora do cronograma;
- 4.391,1 h produtivas;
- 2.197,2 h improdutivas.

Quando o endpoint não coincide, a prévia fica **bloqueada** e nenhum lote divergente pode substituir a base ativa.

## Próxima correção necessária no Oracle/API

O `SELECT` publicado no endpoint precisa retornar, para o projeto #122 e os demais projetos:

1. todas as linhas PPSA necessárias, incluindo Nível 4;
2. planejamento no cronograma e fora do cronograma identificados;
3. `HORAS_PRODUTIVAS_REALIZADAS`;
4. `HORAS_IMPRODUTIVAS_REALIZADAS`;
5. totalizadores compatíveis com a consulta validada no banco.

Até isso ocorrer, o sistema deve manter a última referência válida e não publicar a prévia divergente.
