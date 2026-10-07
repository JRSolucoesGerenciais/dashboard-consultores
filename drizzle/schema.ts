import { boolean, decimal, int, longtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).default("user").notNull(),
  profileRole: mysqlEnum("profileRole", ["diretoria", "pmo", "gerente", "consultor", "cliente", "coordenador"]).default("cliente").notNull(),
  /** Hash scrypt da senha (login próprio). Nunca enviar ao cliente. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** Novos cadastros entram como "pendente" até um administrador liberar. */
  status: mysqlEnum("status", ["pendente", "ativo", "bloqueado"]).default("pendente").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** Projetos liberados para coordenadores e clientes (administradores veem todos). */
export const userProjectAccess = mysqlTable("user_project_access", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userProjectUnique: uniqueIndex("user_project_unique").on(table.userId, table.projectId),
}));

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  client: varchar("client", { length: 255 }).notNull(),
  managerName: varchar("managerName", { length: 120 }).notNull(),
  managerCode: int("managerCode"),
  managerEmail: varchar("managerEmail", { length: 255 }),
  sponsor: varchar("sponsor", { length: 120 }),
  projectType: varchar("projectType", { length: 80 }).default("Não informado").notNull(),
  projectTypeDescription: varchar("projectTypeDescription", { length: 160 }),
  isActive: boolean("isActive").default(true).notNull(),
  sourcePhaseCode: varchar("sourcePhaseCode", { length: 40 }),
  segmentId: int("segmentId"),
  scopeDate: varchar("scopeDate", { length: 10 }),
  closedFlag: varchar("closedFlag", { length: 8 }),
  status: mysqlEnum("status", ["verde", "amarelo", "vermelho", "sem_classificacao"]).default("sem_classificacao").notNull(),
  ragSource: mysqlEnum("ragSource", ["manual", "derivado", "nao_disponivel"]).default("nao_disponivel").notNull(),
  indicatorQuality: mysqlEnum("indicatorQuality", ["completo", "parcial", "nao_disponivel"]).default("nao_disponivel").notNull(),
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
  totalModules: int("totalModules").default(0).notNull(),
  totalActivities: int("totalActivities").default(0).notNull(),
  activeConsultants: int("activeConsultants").default(0).notNull(),
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const weeklyUpdates = mysqlTable("weekly_updates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  weekReference: varchar("weekReference", { length: 80 }).notNull(),
  authorName: varchar("authorName", { length: 120 }).notNull(),
  authorRole: varchar("authorRole", { length: 60 }).default("Gerente de Projetos").notNull(),
  ragStatus: mysqlEnum("ragStatus", ["verde", "amarelo", "vermelho"]).notNull(),
  physicalProgressPct: decimal("physicalProgressPct", { precision: 5, scale: 2 }).notNull(),
  spiValue: decimal("spiValue", { precision: 4, scale: 2 }).notNull(),
  cpiValue: decimal("cpiValue", { precision: 4, scale: 2 }).notNull(),
  hoursConsumedWeek: decimal("hoursConsumedWeek", { precision: 8, scale: 2 }).notNull().default("0.00"),
  whatOccurred: text("whatOccurred").notNull(),
  nextSteps: text("nextSteps").notNull(),
  criticalAttention: text("criticalAttention"),
  clientDecisionsNeeded: text("clientDecisionsNeeded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const weeklyUpdateAttachments = mysqlTable("weekly_update_attachments", {
  id: int("id").autoincrement().primaryKey(),
  weeklyUpdateId: int("weeklyUpdateId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  storageUrl: varchar("storageUrl", { length: 512 }).notNull(),
  contentType: varchar("contentType", { length: 160 }).notNull(),
  fileSize: int("fileSize").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const projectRisks = mysqlTable("project_risks", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 80 }).default("Cronograma").notNull(),
  severity: mysqlEnum("severity", ["baixo", "medio", "alto", "critico"]).default("medio").notNull(),
  probability: mysqlEnum("probability", ["baixo", "medio", "alto"]).default("medio").notNull(),
  impact: text("impact").notNull(),
  mitigationPlan: text("mitigationPlan").notNull(),
  owner: varchar("owner", { length: 120 }).notNull(),
  dueDate: varchar("dueDate", { length: 10 }),
  status: mysqlEnum("status", ["aberto", "em_mitigacao", "resolvido"]).default("aberto").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export const projectActivities = mysqlTable("project_activities", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
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
  level: int("level").default(1).notNull(),
  status: mysqlEnum("status", ["nao_iniciado", "em_andamento", "concluido", "atrasado"]).default("nao_iniciado").notNull(),
  sourceRowNumber: int("sourceRowNumber"),
  sourceCronogramId: int("sourceCronogramId"),
  sourcePpsaId: int("sourcePpsaId"),
  parentPpsaId: int("parentPpsaId"),
  managementCode: int("managementCode"),
  sourceProjectCode: int("sourceProjectCode"),
  sourceProcessCode: int("sourceProcessCode"),
  sourceSubprocessCode: int("sourceSubprocessCode"),
  sourceActivityCode: int("sourceActivityCode"),
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
});

export const projectImportBatches = mysqlTable("project_import_batches", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 255 }),
  storageUrl: varchar("storageUrl", { length: 512 }),
  sourceSheet: varchar("sourceSheet", { length: 80 }).notNull(),
  rowsRead: int("rowsRead").notNull(),
  rowsImported: int("rowsImported").notNull(),
  projectCount: int("projectCount").notNull(),
  status: mysqlEnum("status", ["sucesso", "parcial", "erro"]).notNull(),
  notes: text("notes"),
  validationSummary: text("validationSummary"),
  importedAt: timestamp("importedAt").defaultNow().notNull(),
});

export const spreadsheetImportSessions = mysqlTable("spreadsheet_import_sessions", {
  sessionId: varchar("sessionId", { length: 36 }).primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  notes: text("notes"),
  totalChunks: int("totalChunks").notNull(),
  totalRows: int("totalRows").notNull(),
  status: mysqlEnum("status", ["recebendo", "processando", "concluida", "erro", "expirada"]).default("recebendo").notNull(),
  progressPct: int("progressPct").default(0).notNull(),
  resultBatchId: int("resultBatchId"),
  projectsUpdated: int("projectsUpdated").default(0).notNull(),
  activitiesImported: int("activitiesImported").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const spreadsheetImportChunks = mysqlTable("spreadsheet_import_chunks", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 36 }).notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  rowCount: int("rowCount").notNull(),
  // A View REV06 pode retornar um projeto com mais de 20 mil linhas;
  // MEDIUMTEXT (16 MB) truncava esse chunk antes da importação começar.
  rowsJson: longtext("rowsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const sCurveSnapshots = mysqlTable("s_curve_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  snapshotMonth: varchar("snapshotMonth", { length: 7 }).notNull(),
  moduleName: varchar("moduleName", { length: 80 }).default("todos").notNull(),
  snapshotName: varchar("snapshotName", { length: 160 }).notNull(),
  isBaseline: boolean("isBaseline").default(false).notNull(),
  totalPlannedHours: decimal("totalPlannedHours", { precision: 10, scale: 1 }).notNull().default("0.0"),
  totalActualHours: decimal("totalActualHours", { precision: 10, scale: 1 }).notNull().default("0.0"),
  pointsJson: text("pointsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Foto diária do portfólio (uma por projeto por dia, fuso America/Sao_Paulo).
 * O realizado do dia é a diferença entre duas fotos consecutivas.
 */
export const dailyProjectSnapshots = mysqlTable("daily_project_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  projectId: int("projectId").notNull(),
  projectCode: varchar("projectCode", { length: 64 }).notNull(),
  projectName: varchar("projectName", { length: 255 }).notNull(),
  client: varchar("client", { length: 255 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  plannedHours: decimal("plannedHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  completionPct: decimal("completionPct", { precision: 7, scale: 2 }).notNull().default("0.00"),
  totalActivities: int("totalActivities").notNull().default(0),
  syncRunId: int("syncRunId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  dayProjectUnique: uniqueIndex("daily_project_unique").on(table.snapshotDate, table.projectId),
}));

export const dailyModuleSnapshots = mysqlTable("daily_module_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  projectId: int("projectId").notNull(),
  managementName: varchar("managementName", { length: 120 }).notNull(),
  moduleName: varchar("moduleName", { length: 120 }).notNull(),
  plannedHours: decimal("plannedHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  actualHours: decimal("actualHours", { precision: 12, scale: 2 }).notNull().default("0.00"),
  completionPct: decimal("completionPct", { precision: 7, scale: 2 }).notNull().default("0.00"),
}, (table) => ({
  dayModuleUnique: uniqueIndex("daily_module_unique").on(table.snapshotDate, table.projectId, table.managementName, table.moduleName),
}));

export const oracleApiConfigs = mysqlTable("oracle_api_configs", {
  id: int("id").autoincrement().primaryKey(),
  endpointUrl: varchar("endpointUrl", { length: 512 }).notNull(),
  syncIntervalMinutes: int("syncIntervalMinutes").default(180).notNull(),
  backgroundEnabled: boolean("backgroundEnabled").default(false).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastStatus: mysqlEnum("lastStatus", ["conectado", "sincronizado", "erro", "nao_testado"]).default("nao_testado").notNull(),
  lastMessage: text("lastMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const oracleSyncRuns = mysqlTable("oracle_sync_runs", {
  id: int("id").autoincrement().primaryKey(),
  configId: int("configId").notNull().default(1),
  fileIdentifier: varchar("fileIdentifier", { length: 255 }).notNull(),
  stagingSessionId: varchar("stagingSessionId", { length: 36 }),
  origin: varchar("origin", { length: 80 }).notNull().default("API Oracle"),
  responsible: varchar("responsible", { length: 120 }).notNull().default("Agendamento Periódico"),
  rowsImported: int("rowsImported").notNull().default(0),
  projectCount: int("projectCount").notNull().default(0),
  processedProjectCount: int("processedProjectCount").notNull().default(0),
  activitiesImported: int("activitiesImported").notNull().default(0),
  processingCursor: int("processingCursor").notNull().default(0),
  status: mysqlEnum("status", ["publicada_ativa", "publicada", "erro", "analisada", "processando"]).notNull().default("analisada"),
  progressPct: int("progressPct").default(0).notNull(),
  errorMessage: text("errorMessage"),
  previousStateKey: varchar("previousStateKey", { length: 512 }),
  affectedProjectCodesJson: text("affectedProjectCodesJson"),
  message: text("message"),
  heartbeatAt: timestamp("heartbeatAt"),
  workerToken: varchar("workerToken", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  publishedAt: timestamp("publishedAt"),
});

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
