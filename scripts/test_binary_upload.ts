import fs from "fs";

async function main() {
  const fileName = "ResumoGeraldosProjetos.xls";
  const buffer = fs.readFileSync("/home/ubuntu/upload/ResumoGeraldosProjetos.xls");
  const response = await fetch(`http://localhost:3000/api/spreadsheets/validate?fileName=${encodeURIComponent(fileName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.ms-excel" },
    body: buffer,
  });
  const text = await response.text();
  console.log("status", response.status);
  console.log("contentType", response.headers.get("content-type"));
  console.log(text.slice(0, 500));
  if (!response.ok) process.exit(1);
  const result = JSON.parse(text) as { valid: boolean; totalRows: number; uniqueProjects: number };
  if (!result.valid || result.totalRows < 1000 || result.uniqueProjects < 100) process.exit(2);
  console.log("binary_validation", "OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
