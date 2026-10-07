# Análise da SQL Cronograma Rev02 — 29/09/2026

## Evidências recebidas

- SQL anexada: `/home/ubuntu/upload/SQL-CronogramadeProjetos-Rev02.txt`.
- Exemplo do sistema: projeto 122 / MAJAGUAS.
- Cronograma de referência: 5.960:00 planejado no cronograma + 1.000:00 planejado fora do cronograma = 6.960:00 total planejado; 4.382:36 realizadas; 62,97%.
- API configurada: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2`.

## Regras confirmadas na SQL Rev02

1. `raw_data` calcula a programação por cronograma e usa `projetomodulo` para completar dias quando `diff_dias_programada` é nulo.
2. `base_total_hora_dias_programados` usa `qtd_semana_planejada * 5 * 8` quando a hora-fonte é `':'`; portanto o módulo usa **8 h/dia**, não 10 h/dia.
3. `n3_sums`, `n2_eff`, `n2_sums` e `corrected_data` fazem a consolidação hierárquica N3 → N2 → N1.
4. O `UNION ALL` separa apontamentos sem cronograma e atribui `base_total_hora_dias_programados = '0:00'` para esse bloco; a parcela fora do cronograma vem dos módulos com apontamento sem `idprojetocronograma`.
5. O SELECT final expõe `total_hora_dias_programados`, `horas_total`, `status_atividade` e datas, mas não expõe `qtd_semana_planejada`, `base_total_hora_dias_programados` nem um indicador textual explícito de escopo.
6. A SQL final já entrega os valores hierárquicos corrigidos. O aplicativo não deve aplicar a mesma correção PPSA novamente sobre essa saída.

## Diagnóstico do estado atual

- O snapshot antigo da API (`/tmp/csagenda-response.bin`) ainda retorna o modelo anterior com 10 h/dia, projeto 122 em 142.950 h planejadas e 3.554,7 h realizadas.
- A consulta direta do endpoint em 29/09/2026 respondeu HTTP 522; logo, a nova SQL ainda não pôde ser validada ao vivo neste ambiente.
- A base restaurada do projeto 122 está em 7.670,0 h planejadas e 4.375,1 h realizadas, baseada na planilha oficial anterior.
- O endpoint atualizado deverá ser importado como fonte autoritativa quando voltar a responder e tiver a SQL Rev02 publicada.

## Decisão de implementação

- Detectar a saída final Rev02 pela presença dos campos específicos (`DATA_TERMINO_REALIZADO_MODULO` e/ou `BASE_TOTAL_HORA_DIAS_PROGRAMADOS`) e não executar uma segunda correção hierárquica.
- Para cargas sem esses campos, manter o fallback hierárquico já existente.
- Adicionar no preview e no cronograma a separação `idprojetocronograma != null` (planejado no cronograma) versus `idprojetocronograma == null` (fora do cronograma), sempre usando Nível 1 para totalizadores.
- Só publicar o resultado global após a API responder e os quatro indicadores do projeto 122 conferirem com 5.960:00, 1.000:00, 6.960:00 e 4.382:36.
