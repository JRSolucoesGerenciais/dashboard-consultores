import { boolean, decimal, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 32 }).$type<"admin" | "user">().default("user").notNull(),
  profileRole: varchar("profileRole", { length: 32 }).$type<"diretoria" | "pmo" | "gerente" | "consultor" | "cliente" | "coordenador">().default("cliente").notNull(),
  /** Hash scrypt da senha (login próprio). Nunca enviar ao cliente. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** Novos cadastros entram como "pendente" até um administrador liberar. */
  status: varchar("status", { length: 32 }).$type<"pendente" | "ativo" | "bloqueado">().default("pendente").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}).enableRLS();

/** Projetos liberados para coordenadores e clientes (administradores veem todos). */
export const userProjectAccess = pgTable("user_project_access", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  projectId: integer("projectId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userProjectUnique: uniqueIndex("user_project_unique").on(table.userId, table.projectId),
})).enableRLS();

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  client: varchar("client", { length: 255 }).notNull(),
  managerName: varchar("managerName", { length: 120 }).notNull(),
  managerCode: integer("managerCode"),
  managerEmail: varchar("managerEmail", { length: 255 }),
  sponsor: varchar("sponsor", { length: 120 }),
  projectType: varchar("projectType", { length: 80 }).default("Não informado").notNull(),
  projectTypeDescription: varchar("projectTypeDescription", { length: 160 }),
  isActive: boolean("isActive").default(true).notNull(),
  sourcePhaseCode: varchar("sourcePhaseCode", { length: 40 }),
  segmentId: integer("segmentId"),
  scopeDate: varchar("scopeDate", { length: 10 }),
  closedFlag: varchar("closedFlag", { length: 8 }),
  status: varchar("status", { length: 32 }).$type<"verde" | "amarelo" | "vermelho" | "sem_classificacao">().default("sem_classificacao").notNull(),
  ragSource: varchar("ragSource", { length: 32 }).$type<"manual" | "derivado" | "nao_disponivel">().default("nao_disponivel").notNull(),
  indicatorQuality: varchar("indicatorQuality", { length: 32 }).$type<"completo" | "parcial" | "nao_disponivel">().default("nao_disponivel").notNull(),
  stage: varchar("stage", { length: 80 }).default("Execução").notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(),
  plannedEndDate: varchar("plannedEndDate", { length: 10 }).notNull(),
  actualStartDate: varchar("actualStartDate", { length: 10 }).notNull().default("Sem data"),
  actualEndDate: varchar("actualEndDate", { length: 10 }).notNull().default("Sem data"),
  finalDate: varchar("finalDate", { length: 10 }).notNull().default("Sem data"),
  projectedEndDate: varchar("projectedEndDate", { length: 10 }).notNull(),
  baselineHours: decimal("baselineHours", { precision: 10, scale: 2 }).notNull().default("0.00"),
  plannedHours: decimal("plannedHours", { precision: 10, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 10, scale: 2 }).notNull().default("0.00"),
  plannedHoursInSchedule: decimal("plannedHoursInSchedule", { precision: 10, scale: 2 }),
  plannedHoursOutsideSchedule: decimal("plannedHoursOutsideSchedule", { precision: 10, scale: 2 }),
  productiveActualHours: decimal("productiveActualHours", { precision: 10, scale: 2 }),
  unproductiveActualHours: decimal("unproductiveActualHours", { precision: 10, scale: 2 }),
  hoursMetricsSource: varchar("hoursMetricsSource", { length: 80 }),
  completionPct: decimal("completionPct", { precision: 5, scale: 2 }).notNull().default("0.00"),
  spi: decimal("spi", { precision: 4, scale: 2 }).notNull().default("1.00"),
  cpi: decimal("cpi", { precision: 4, scale: 2 }).notNull().default("1.00"),
  totalModules: integer("totalModules").default(0).notNull(),
  totalActivities: integer("totalActivities").default(0).notNull(),
  activeConsultants: integer("activeConsultants").default(0).notNull(),
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}).enableRLS();

export const weeklyUpdates = pgTable("weekly_updates", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  weekReference: varchar("weekReference", { length: 80 }).notNull(),
  authorName: varchar("authorName", { length: 120 }).notNull(),
  authorRole: varchar("authorRole", { length: 60 }).default("Gerente de Projetos").notNull(),
  ragStatus: varchar("ragStatus", { length: 32 }).$type<"verde" | "amarelo" | "vermelho">().notNull(),
  physicalProgressPct: decimal("physicalProgressPct", { precision: 5, scale: 2 }).notNull(),
  spiValue: decimal("spiValue", { precision: 4, scale: 2 }).notNull(),
  cpiValue: decimal("cpiValue", { precision: 4, scale: 2 }).notNull(),
  hoursConsumedWeek: decimal("hoursConsumedWeek", { precision: 8, scale: 2 }).notNull().default("0.00"),
  whatOccurred: text("whatOccurred").notNull(),
  nextSteps: text("nextSteps").notNull(),
  criticalAttention: text("criticalAttention"),
  clientDecisionsNeeded: text("clientDecisionsNeeded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();

export const weeklyUpdateAttachments = pgTable("weekly_update_attachments", {
  id: serial("id").primaryKey(),
  weeklyUpdateId: integer("weeklyUpdateId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  storageUrl: varchar("storageUrl", { length: 512 }).notNull(),
  contentType: varchar("contentType", { length: 160 }).notNull(),
  fileSize: integer("fileSize").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();

export const projectRisks = pgTable("project_risks", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 80 }).default("Cronograma").notNull(),
  severity: varchar("severity", { length: 32 }).$type<"baixo" | "medio" | "alto" | "critico">().default("medio").notNull(),
  probability: varchar("probability", { length: 32 }).$type<"baixo" | "medio" | "alto">().default("medio").notNull(),
  impact: text("impact").notNull(),
  mitigationPlan: text("mitigationPlan").notNull(),
  owner: varchar("owner", { length: 120 }).notNull(),
  dueDate: varchar("dueDate", { length: 10 }),
  status: varchar("status", { length: 32 }).$type<"aberto" | "em_mitigacao" | "resolvido">().default("aberto").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
}).enableRLS();

export const projectActivities = pgTable("project_activities", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  ppsaCode: varchar("ppsaCode", { length: 80 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  process: varchar("process", { length: 120 }).notNull(),
  subprocess: varchar("subprocess", { length: 120 }).notNull(),
  activity: varchar("activity", { length: 120 }).notNull(),
  managementName: varchar("managementName", { length: 120 }),
  moduleName: varchar("moduleName", { length: 80 }).notNull(),
  plannedStart: varchar("plannedStart", { length: 10 }).notNull(),
  plannedEnd: varchar("plannedEnd", { length: 10 }).notNull(),
  actualStart: varchar("actualStart", { length: 10 }),
  actualEnd: varchar("actualEnd", { length: 10 }),
  plannedHours: decimal("plannedHours", { precision: 8, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 8, scale: 2 }).notNull().default("0.00"),
  plannedActivityHours: decimal("plannedActivityHours", { precision: 10, scale: 2 }),
  actualAtomicHours: decimal("actualAtomicHours", { precision: 10, scale: 2 }),
  actualConsolidatedHours: decimal("actualConsolidatedHours", { precision: 10, scale: 2 }),
  progressPct: decimal("progressPct", { precision: 5, scale: 2 }).notNull().default("0.00"),
  resource: varchar("resource", { length: 120 }),
  location: varchar("location", { length: 40 }).default("Presencial"),
  level: integer("level").default(1).notNull(),
  status: varchar("status", { length: 32 }).$type<"nao_iniciado" | "em_andamento" | "concluido" | "atrasado">().default("nao_iniciado").notNull(),
  sourceRowNumber: integer("sourceRowNumber"),
  sourceCronogramId: integer("sourceCronogramId"),
  sourcePpsaId: integer("sourcePpsaId"),
  parentPpsaId: integer("parentPpsaId"),
  managementCode: integer("managementCode"),
  sourceProjectCode: integer("sourceProjectCode"),
  sourceProcessCode: integer("sourceProcessCode"),
  sourceSubprocessCode: integer("sourceSubprocessCode"),
  sourceActivityCode: integer("sourceActivityCode"),
  levelChild: varchar("levelChild", { length: 80 }),
  levelParent: varchar("levelParent", { length: 80 }),
  plannedDays: decimal("plannedDays", { precision: 10, scale: 2 }),
  plannedWeeks: decimal("plannedWeeks", { precision: 10, scale: 2 }),
  plannedModuleHours: decimal("plannedModuleHours", { precision: 10, scale: 2 }),
  moduleActualHours: decimal("moduleActualHours", { precision: 10, scale: 2 }),
  moduleSummaryPlannedHours: decimal("moduleSummaryPlannedHours", { precision: 10, scale: 2 }),
  moduleSummaryActualHours: decimal("moduleSummaryActualHours", { precision: 10, scale: 2 }),
  moduleSummaryCompletionPct: decimal("moduleSummaryCompletionPct", { precision: 10, scale: 2 }),
  managementSummaryPlannedHours: decimal("managementSummaryPlannedHours", { precision: 12, scale: 2 }),
  managementSummaryActualHours: decimal("managementSummaryActualHours", { precision: 12, scale: 2 }),
  managementSummaryCompletionPct: decimal("managementSummaryCompletionPct", { precision: 10, scale: 2 }),
  utilizationPct: decimal("utilizationPct", { precision: 12, scale: 6 }),
  utilizationPctLevel: decimal("utilizationPctLevel", { precision: 12, scale: 6 }),
  totalUtilizationLevel: decimal("totalUtilizationLevel", { precision: 12, scale: 6 }),
  plannedHoursText: varchar("plannedHoursText", { length: 32 }),
  elapsedSchedulePct: decimal("elapsedSchedulePct", { precision: 10, scale: 2 }),
  hoursCompletionPct: decimal("hoursCompletionPct", { precision: 10, scale: 2 }),
  hoursOverrunStatus: varchar("hoursOverrunStatus", { length: 160 }),
  sourceStatus: varchar("sourceStatus", { length: 40 }),
  sourceRecordType: varchar("sourceRecordType", { length: 30 }),
  moduleActualEndDate: varchar("moduleActualEndDate", { length: 10 }),
  standardDuration: varchar("standardDuration", { length: 32 }),
  plannedMorningStart: varchar("plannedMorningStart", { length: 8 }),
  plannedMorningEnd: varchar("plannedMorningEnd", { length: 8 }),
  plannedAfternoonStart: varchar("plannedAfternoonStart", { length: 8 }),
  plannedAfternoonEnd: varchar("plannedAfternoonEnd", { length: 8 }),
  sourceFileName: varchar("sourceFileName", { length: 255 }),
  sourceSheet: varchar("sourceSheet", { length: 80 }),
  importedAt: timestamp("importedAt"),
}).enableRLS();

export const projectImportBatches = pgTable("project_import_batches", {
  id: serial("id").primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 255 }),
  storageUrl: varchar("storageUrl", { length: 512 }),
  sourceSheet: varchar("sourceSheet", { length: 80 }).notNull(),
  rowsRead: integer("rowsRead").notNull(),
  rowsImported: integer("rowsImported").notNull(),
  projectCount: integer("projectCount").notNull(),
  status: varchar("status", { length: 32 }).$type<"sucesso" | "parcial" | "erro">().notNull(),
  notes: text("notes"),
  validationSummary: text("validationSummary"),
  importedAt: timestamp("importedAt").defaultNow().notNull(),
}).enableRLS();

export const spreadsheetImportSessions = pgTable("spreadsheet_import_sessions", {
  sessionId: varchar("sessionId", { length: 36 }).primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  notes: text("notes"),
  totalChunks: integer("totalChunks").notNull(),
  totalRows: integer("totalRows").notNull(),
  status: varchar("status", { length: 32 }).$type<"recebendo" | "processando" | "concluida" | "erro" | "expirada">().default("recebendo").notNull(),
  progressPct: integer("progressPct").default(0).notNull(),
  resultBatchId: integer("resultBatchId"),
  projectsUpdated: integer("projectsUpdated").default(0).notNull(),
  activitiesImported: integer("activitiesImported").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}).enableRLS();

export const spreadsheetImportChunks = pgTable("spreadsheet_import_chunks", {
  id: serial("id").primaryKey(),
  sessionId: varchar("sessionId", { length: 36 }).notNull(),
  chunkIndex: integer("chunkIndex").notNull(),
  rowCount: integer("rowCount").notNull(),
  // A View REV06 pode retornar um projeto com mais de 20 mil linhas;
  // MEDIUMTEXT (16 MB) truncava esse chunk antes da importação começar.
  rowsJson: text("rowsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();

export const sCurveSnapshots = pgTable("s_curve_snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  snapshotMonth: varchar("snapshotMonth", { length: 7 }).notNull(),
  moduleName: varchar("moduleName", { length: 80 }).default("todos").notNull(),
  snapshotName: varchar("snapshotName", { length: 160 }).notNull(),
  isBaseline: boolean("isBaseline").default(false).notNull(),
  totalPlannedHours: decimal("totalPlannedHours", { precision: 10, scale: 1 }).notNull().default("0.0"),
  totalActualHours: decimal("totalActualHours", { precision: 10, scale: 1 }).notNull().default("0.0"),
  pointsJson: text("pointsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();

/**
 * Foto diária do portfólio (uma por projeto por dia, fuso America/Sao_Paulo).
 * O realizado do dia é a diferença entre duas fotos consecutivas.
 */
export const dailyProjectSnapshots = pgTable("daily_project_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  projectId: integer("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  projectName: varchar("projectName", { length: 255 }).notNull(),
  client: varchar("client", { length: 255 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  plannedHours: decimal("plannedHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  completionPct: decimal("completionPct", { precision: 7, scale: 2 }).notNull().default("0.00"),
  totalActivities: integer("totalActivities").notNull().default(0),
  syncRunId: integer("syncRunId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  dayProjectUnique: uniqueIndex("daily_project_unique").on(table.snapshotDate, table.projectId),
})).enableRLS();

export const dailyModuleSnapshots = pgTable("daily_module_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  projectId: integer("projectId").notNull(),
  managementName: varchar("managementName", { length: 120 }).notNull(),
  moduleName: varchar("moduleName", { length: 120 }).notNull(),
  plannedHours: decimal("plannedHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  completionPct: decimal("completionPct", { precision: 7, scale: 2 }).notNull().default("0.00"),
}, (table) => ({
  dayModuleUnique: uniqueIndex("daily_module_unique").on(table.snapshotDate, table.projectId, table.managementName, table.moduleName),
})).enableRLS();

export const oracleApiConfigs = pgTable("oracle_api_configs", {
  id: serial("id").primaryKey(),
  endpointUrl: varchar("endpointUrl", { length: 512 }).notNull(),
  syncIntervalMinutes: integer("syncIntervalMinutes").default(180).notNull(),
  backgroundEnabled: boolean("backgroundEnabled").default(false).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastStatus: varchar("lastStatus", { length: 32 }).$type<"conectado" | "sincronizado" | "erro" | "nao_testado">().default("nao_testado").notNull(),
  lastMessage: text("lastMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}).enableRLS();

export const oracleSyncRuns = pgTable("oracle_sync_runs", {
  id: serial("id").primaryKey(),
  configId: integer("configId").notNull().default(1),
  fileIdentifier: varchar("fileIdentifier", { length: 255 }).notNull(),
  stagingSessionId: varchar("stagingSessionId", { length: 36 }),
  origin: varchar("origin", { length: 80 }).notNull().default("API Oracle"),
  responsible: varchar("responsible", { length: 120 }).notNull().default("Agendamento Periódico"),
  rowsImported: integer("rowsImported").notNull().default(0),
  projectCount: integer("projectCount").notNull().default(0),
  processedProjectCount: integer("processedProjectCount").notNull().default(0),
  activitiesImported: integer("activitiesImported").notNull().default(0),
  processingCursor: integer("processingCursor").notNull().default(0),
  status: varchar("status", { length: 32 }).$type<"publicada_ativa" | "publicada" | "erro" | "analisada" | "processando">().notNull().default("analisada"),
  progressPct: integer("progressPct").default(0).notNull(),
  errorMessage: text("errorMessage"),
  previousStateKey: varchar("previousStateKey", { length: 512 }),
  affectedProjectCodesJson: text("affectedProjectCodesJson"),
  message: text("message"),
  heartbeatAt: timestamp("heartbeatAt"),
  workerToken: varchar("workerToken", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  publishedAt: timestamp("publishedAt"),
}).enableRLS();

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserProjectAccess = typeof userProjectAccess.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type WeeklyUpdate = typeof weeklyUpdates.$inferSelect;
export type InsertWeeklyUpdate = typeof weeklyUpdates.$inferInsert;
export type WeeklyUpdateAttachment = typeof weeklyUpdateAttachments.$inferSelect;
export type InsertWeeklyUpdateAttachment = typeof weeklyUpdateAttachments.$inferInsert;
export type ProjectRisk = typeof projectRisks.$inferSelect;
export type InsertProjectRisk = typeof projectRisks.$inferInsert;
export type ProjectActivity = typeof projectActivities.$inferSelect;
export type InsertProjectActivity = typeof projectActivities.$inferInsert;
export type ProjectImportBatch = typeof projectImportBatches.$inferSelect;
export type InsertProjectImportBatch = typeof projectImportBatches.$inferInsert;
export type SpreadsheetImportSession = typeof spreadsheetImportSessions.$inferSelect;
export type InsertSpreadsheetImportSession = typeof spreadsheetImportSessions.$inferInsert;
export type SpreadsheetImportChunk = typeof spreadsheetImportChunks.$inferSelect;
export type InsertSpreadsheetImportChunk = typeof spreadsheetImportChunks.$inferInsert;
export type SCurveSnapshot = typeof sCurveSnapshots.$inferSelect;
export type InsertSCurveSnapshot = typeof sCurveSnapshots.$inferInsert;
export type DailyProjectSnapshot = typeof dailyProjectSnapshots.$inferSelect;
export type DailyModuleSnapshot = typeof dailyModuleSnapshots.$inferSelect;
export type OracleApiConfig = typeof oracleApiConfigs.$inferSelect;
export type InsertOracleApiConfig = typeof oracleApiConfigs.$inferInsert;
export type OracleSyncRun = typeof oracleSyncRuns.$inferSelect;
export type InsertOracleSyncRun = typeof oracleSyncRuns.$inferInsert;
