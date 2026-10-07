# Auditoria Técnica da API CSAgenda e Integração da View REV06
Data: 01/10/2026 21:04 BRT (02/10/2026 00:04 UTC)

## 1. Comportamento e Payload da API CSAgenda Externa
- Endpoint consultado: `https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2`
- Resposta HTTP: `HTTP 200`
- Tamanho total: **58.804.259 bytes (~58,8 MB)**, compactado em trânsito com GZIP (1.144.590 bytes).
- Tempo de resposta: TTFB entre 36 e 42 segundos; transmissão completa em ~41 segundos via Node.js.
- Registros retornados: **46.429 linhas**, cobrindo **322 projetos**.

## 2. Diagnóstico da Falha Reportada pelo Usuário
1. **Concentração extrema no Projeto #266**:
   - O projeto #266 sozinho contém **22.919 linhas** das 46.429 retornadas (cerca de 50% de todo o payload).
   - O staging do banco gravava o JSON desse projeto em uma única linha da tabela `spreadsheet_import_chunks`.
   - A coluna `rowsJson` estava tipada como `MEDIUMTEXT` (limite MySQL de 16 MB). Ao tentar salvar o bloco de 55 MB, o banco disparava o erro `ER_DATA_TOO_LONG: Data Too Long, field len 65535, data len 55907500`.
   - A mensagem de erro gerada no `update oracle_api_configs` excedia o tamanho da coluna de log, gerando erro em cascata e deixando a interface sem resposta clara de prévia.

2. **Detecção do Contrato REV06**:
   - As colunas exclusivas da View REV06 (`PERCENTUAL_HORAS_REALIZADA_ORIGINAL` e `STATUS_ESTOURO_HORAS`) aparecem em 1.208 linhas, concentradas principalmente nos projetos #122, #182, #200, #217 e #322.
   - Muitos outros projetos da API (incluindo o projeto #6 que abre a lista) não possuem essa coluna preenchida ou a omitem no JSON.
   - Ao processar a importação em lotes incrementais, se um bloco contivesse apenas projetos onde essas colunas eram nulas/omitidas, a classificação REV06 era perdida e o lote caía no fallback legado.

## 3. Correções Aplicadas no Código e no Banco
1. **Migração do Staging para LONGTEXT**:
   - Alterada a tabela `spreadsheet_import_chunks.rowsJson` de `MEDIUMTEXT` para `LONGTEXT` (suporta até 4 GB).
   - Migração `drizzle/0022_premium_lyja.sql` gerada e aplicada com sucesso no banco da aplicação via `webdev_execute_sql`.
   - A inserção dos chunks em lote foi dividida em blocos menores (`slice(offset, offset + 8)`) para evitar estourar o buffer de pacotes da conexão MySQL.

2. **Preservação do Contrato REV06**:
   - O metadado da sessão agora armazena explicitamente o `sourceContract: "REV06"`.
   - A função `processParsedSpreadsheetRows` aceita `sourceContract` vindo da prévia e não reclassifica lotes individuais isoladamente, garantindo que o PPSA Nível 1 corrigido da REV06 seja mantido em todos os lotes de todos os 322 projetos.
   - O truncamento de mensagens de erro protege a tabela `oracle_api_configs` contra erros gigantes de banco ou rede.

3. **Status do Projeto Majaguas #122 na Nova Carga**:
   - Retorna exatamente **368 linhas**, com as colunas da REV06 presentes (`PERCENTUAL_HORAS_REALIZADA_ORIGINAL: 0` a `173,33%`, `STATUS_ESTOURO_HORAS: SALDO/ESTOURO`).
   - A prévia e a importação reconhecem a fonte como autoritativa sem aplicar segunda consolidação hierárquica.
