import fs from "fs";
import { processAndImportSpreadsheet } from "../server/spreadsheetService";

async function main() {
  const filePath = "/home/ubuntu/upload/ResumoGeraldosProjetos.xls";
  const buffer = fs.readFileSync(filePath);
  console.log("Iniciando carga da planilha atualizada...");
  const result = await processAndImportSpreadsheet(
    "ResumoGeraldosProjetos.xls",
    buffer,
    "Carga da planilha atualizada enviada pelo usuário via painel de dados."
  );
  console.log("Resultado da carga:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Erro na carga:", err);
  process.exit(1);
});
