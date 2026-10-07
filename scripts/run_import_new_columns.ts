import fs from "fs";
import { processAndImportSpreadsheet } from "../server/spreadsheetService";

async function main() {
  const filePath = "/home/ubuntu/upload/ResumoGeraldosProjetos.xls";
  const buffer = fs.readFileSync(filePath);
  const result = await processAndImportSpreadsheet(
    "ResumoGeraldosProjetos.xls",
    buffer,
    "Carga com nova coluna TIPO_PROJETO_DESCRICAO da planilha atualizada."
  );
  console.log("RESULT", JSON.stringify({
    valid: result.valid,
    sheetName: result.sheetName,
    totalRows: result.totalRows,
    uniqueProjects: result.uniqueProjects,
    projectsUpdated: result.projectsUpdated,
    activitiesImported: result.activitiesImported,
    batchId: result.batchId,
  }, null, 2));
}

main().catch((err) => {
  console.error("FATAL_IMPORT_ERROR", err);
  process.exit(1);
});
