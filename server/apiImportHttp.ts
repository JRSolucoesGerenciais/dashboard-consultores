import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import {
  buildApiImportWorkbookBuffer,
  processAndImportSpreadsheet,
  type ApiImportPayload,
} from "./spreadsheetService";

function getHeader(req: Request, name: string): string {
  const value = req.header(name);
  return value ? String(value).trim() : "";
}

function getProvidedApiKey(req: Request): string {
  const authorization = getHeader(req, "authorization");
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return getHeader(req, "x-api-key");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function reject(message: string, status: number, res: Response) {
  res.status(status).json({ success: false, message });
}

function validatePayload(value: unknown): ApiImportPayload {
  if (!value || typeof value !== "object") throw new Error("O corpo da requisição deve ser um objeto JSON.");
  const payload = value as Partial<ApiImportPayload>;
  if (!Array.isArray(payload.projects) || payload.projects.length === 0) {
    throw new Error("Informe pelo menos um projeto em projects[].");
  }
  if (payload.projects.length > 1000) throw new Error("O lote suporta no máximo 1.000 projetos.");
  for (const project of payload.projects) {
    if (!project || typeof project !== "object" || !String(project.code || "").trim() || !String(project.name || "").trim() || !String(project.client || "").trim()) {
      throw new Error("Cada projeto deve informar code, name e client.");
    }
    if (!Array.isArray(project.activities)) throw new Error(`O projeto ${project.code} deve informar activities[].`);
    if (project.activities.length > 10000) throw new Error(`O projeto ${project.code} excede o limite de 10.000 atividades.`);
    for (const activity of project.activities) {
      if (!activity || typeof activity !== "object" || !String(activity.ppsaCode || "").trim() || !String(activity.description || "").trim()) {
        throw new Error(`Cada atividade do projeto ${project.code} deve informar ppsaCode e description.`);
      }
    }
  }
  return {
    source: String(payload.source || "API externa").slice(0, 120),
    notes: payload.notes ? String(payload.notes).slice(0, 2000) : undefined,
    projects: payload.projects as ApiImportPayload["projects"],
  };
}

export function registerApiImportRoutes(app: Express) {
  app.post("/api/integrations/project-import", async (req, res) => {
    const configuredApiKey = process.env.PROJECT_IMPORT_API_KEY || ENV.projectImportApiKey;
    if (!configuredApiKey) {
      reject("API de importação não configurada. Defina PROJECT_IMPORT_API_KEY no ambiente do servidor.", 503, res);
      return;
    }
    const providedApiKey = getProvidedApiKey(req);
    if (!providedApiKey || !safeEquals(providedApiKey, configuredApiKey)) {
      reject("Chave de API ausente ou inválida.", 401, res);
      return;
    }

    try {
      const payload = validatePayload(req.body);
      const buffer = buildApiImportWorkbookBuffer(payload);
      const result = await processAndImportSpreadsheet(
        `api-${payload.source?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "integracao"}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        buffer,
        payload.notes || `Importação recebida pela API (${payload.source}).`
      );
      res.status(200).json({
        ...result,
        success: true,
        importMessage: "Importação por API concluída com sucesso.",
        mode: "substitui o cronograma dos projetos enviados e preserva os demais projetos do catálogo",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível importar os dados pela API.";
      const status = /deve|informe|limite|atividade|projeto|JSON|API/i.test(message) ? 400 : 500;
      reject(message, status, res);
    }
  });
}
