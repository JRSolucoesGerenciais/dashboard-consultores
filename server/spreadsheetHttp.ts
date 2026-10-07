import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import {
  processAndImportSpreadsheet,
  validateSpreadsheetBuffer,
} from "./spreadsheetService";

function getRequestParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  return value ? String(value) : undefined;
}

function getUploadedFileName(req: Request): string {
  const fileReq = (req as any).file;
  if (fileReq && fileReq.originalname) {
    return String(fileReq.originalname).replace(/[\\/]/g, "_").slice(0, 255);
  }
  const fileName = getRequestParam(req, "fileName") || "planilha-projetos.xls";
  return fileName.replace(/[\\/]/g, "_").slice(0, 255);
}

function getUploadedNotes(req: Request): string | undefined {
  const bodyNotes = req.body && typeof req.body === "object" ? (req.body as any).notes : undefined;
  if (bodyNotes) return String(bodyNotes).slice(0, 2000);
  const notes = getRequestParam(req, "notes");
  return notes ? notes.slice(0, 2000) : undefined;
}

function getBodyBuffer(req: Request): Buffer {
  const fileReq = (req as any).file;
  if (fileReq && Buffer.isBuffer(fileReq.buffer)) {
    return fileReq.buffer;
  }
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  return Buffer.alloc(0);
}

function sendError(res: Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /estrutura|colunas|vazia|formato|planilha/i.test(message) ? 400 : 500;
  res.status(status).json({ message });
}

export function registerSpreadsheetHttpRoutes(app: Express) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024 },
  });

  const hybridUpload = (req: Request, res: Response, next: () => void) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      upload.single("file")(req, res, (err) => {
        if (err) {
          res.status(400).json({ message: `Erro no upload multipart: ${err.message}` });
          return;
        }
        next();
      });
    } else {
      expressRaw(req, res, next);
    }
  };

  app.post("/api/spreadsheets/validate", hybridUpload, async (req, res) => {
    try {
      const buffer = getBodyBuffer(req);
      if (!buffer.length) {
        res.status(400).json({ message: "Nenhum arquivo foi recebido." });
        return;
      }
      const result = validateSpreadsheetBuffer(getUploadedFileName(req), buffer);
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error, "Não foi possível validar a planilha.");
    }
  });

  app.post("/api/spreadsheets/import", hybridUpload, async (req, res) => {
    try {
      const buffer = getBodyBuffer(req);
      if (!buffer.length) {
        res.status(400).json({ message: "Nenhum arquivo foi recebido." });
        return;
      }
      const result = await processAndImportSpreadsheet(
        getUploadedFileName(req),
        buffer,
        getUploadedNotes(req)
      );
      res.status(200).json(result);
    } catch (error) {
      sendError(res, error, "Não foi possível importar a planilha.");
    }
  });
}

// Express' raw parser is intentionally scoped to these two upload routes and
// registered before the global JSON parser in index.ts.
const expressRaw = express.raw({ type: "*/*", limit: "50mb" });
