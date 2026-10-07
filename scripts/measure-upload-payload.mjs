import fs from "node:fs";
import * as XLSX from "xlsx";

const filePath = process.argv[2] || "/home/ubuntu/upload/ResumoGeraldosProjetos.xls";
const file = fs.readFileSync(filePath);
const workbook = XLSX.read(file, { type: "buffer", cellDates: true });
const sheetName = workbook.SheetNames.find((name) => /select|dual/i.test(name)) || workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
const json = JSON.stringify({ fileName: "ResumoGeraldosProjetos.xls", rows });
console.log(JSON.stringify({ fileBytes: file.length, sheetName, rowCount: rows.length, jsonBytes: Buffer.byteLength(json), jsonMiB: (Buffer.byteLength(json) / 1024 / 1024).toFixed(2) }));
