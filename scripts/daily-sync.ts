/**
 * Rotina diária (23h, Brasília): sincroniza a API CSAgenda, aguarda a
 * publicação terminar e grava a foto do dia para a comparação dia a dia.
 *
 *   pnpm sync:daily
 *
 * Variáveis: DATABASE_URL, ORACLE_API_TOKEN. O endereço da API vem da
 * configuração salva na tela "Atualizar planilha". Código de saída 1 em falha.
 *
 * Mantenha a sincronização periódica em segundo plano DESLIGADA na tela de
 * integração: duas sincronizações simultâneas cancelam uma à outra.
 */
import "dotenv/config";
import { captureDailySnapshot, getDailyComparison } from "../server/dailySnapshot";
import { getOracleConfig, getOracleSyncRunStatus, publishAnalyzedPreview, testOracleConnection } from "../server/oracleSyncService";

const POLL_MS = 2_000;
const TIMEOUT_MS = 45 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => console.log(`[daily-sync ${new Date().toISOString()}] ${message}`);

async function main() {
  const config = await getOracleConfig();
  if (!config.endpointUrl) throw new Error("Endpoint da API CSAgenda não configurado.");
  if (config.backgroundEnabled) log("Aviso: a sincronização periódica em segundo plano está ligada; desligue-a para evitar conflito.");

  log("Consultando a API e montando a prévia...");
  const preview = await testOracleConnection(config.endpointUrl);
  if (!preview.success || !preview.preview?.stagingSessionId) {
    throw new Error(`Prévia indisponível: ${preview.message}`);
  }
  log(`Prévia: ${preview.previewRowsCount} linhas, ${preview.preview.projectsCount} projetos.`);

  const published = await publishAnalyzedPreview({
    endpointUrl: config.endpointUrl,
    responsible: "Rotina diária 23h",
    fileIdentifier: preview.previewJsonFileName,
    rowsCount: preview.previewRowsCount,
    projectCount: preview.preview.projectsCount,
    stagingSessionId: preview.preview.stagingSessionId,
  });
  log(`Publicação iniciada (execução ${published.runId}).`);

  const startedAt = Date.now();
  let status = await getOracleSyncRunStatus(published.runId);
  while (status.status === "processando") {
    if (Date.now() - startedAt > TIMEOUT_MS) throw new Error("Tempo limite excedido aguardando a publicação.");
    await sleep(POLL_MS);
    status = await getOracleSyncRunStatus(published.runId);
  }
  if (status.status === "erro") throw new Error(`Publicação falhou: ${status.errorMessage ?? status.message}`);
  log(`Publicação concluída (${status.status}, ${status.rowsImported} linhas).`);

  const snapshot = await captureDailySnapshot({ syncRunId: published.runId });
  log(`Foto de ${snapshot.snapshotDate}: ${snapshot.projects} projetos, ${snapshot.modules} módulos.`);

  const comparison = await getDailyComparison({ toDate: snapshot.snapshotDate, projectIds: null });
  if (!comparison.fromDate || !comparison.totals) {
    log("Primeira foto registrada: a comparação começa amanhã.");
    return;
  }
  const { totals } = comparison;
  log(`Comparação ${comparison.fromDate} → ${comparison.toDate}: ${totals.changed} de ${totals.projects} projetos mudaram; ${totals.actualDelta.toFixed(2)} h apontadas; ${totals.corrections} correção(ões) na origem.`);
  for (const project of comparison.projects.filter((p) => p.kind === "alterado").slice(0, 10)) {
    log(`  #${project.projectCode} ${project.projectName}: ${project.actualDelta >= 0 ? "+" : ""}${project.actualDelta.toFixed(2)} h`);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(`[daily-sync] FALHA: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
