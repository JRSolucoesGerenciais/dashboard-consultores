CREATE TABLE "daily_module_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshotDate" varchar(10) NOT NULL,
	"projectId" integer NOT NULL,
	"managementName" varchar(120) NOT NULL,
	"moduleName" varchar(120) NOT NULL,
	"plannedHours" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"actualHours" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"completionPct" numeric(7, 2) DEFAULT '0.00' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_module_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_project_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshotDate" varchar(10) NOT NULL,
	"projectId" integer NOT NULL,
	"projectCode" varchar(64) NOT NULL,
	"projectName" varchar(255) NOT NULL,
	"client" varchar(255) NOT NULL,
	"status" varchar(24) NOT NULL,
	"plannedHours" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"actualHours" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"completionPct" numeric(7, 2) DEFAULT '0.00' NOT NULL,
	"totalActivities" integer DEFAULT 0 NOT NULL,
	"syncRunId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_project_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oracle_api_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpointUrl" varchar(512) NOT NULL,
	"syncIntervalMinutes" integer DEFAULT 180 NOT NULL,
	"backgroundEnabled" boolean DEFAULT false NOT NULL,
	"lastAttemptAt" timestamp,
	"lastSuccessAt" timestamp,
	"lastStatus" varchar(32) DEFAULT 'nao_testado' NOT NULL,
	"lastMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oracle_api_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oracle_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"configId" integer DEFAULT 1 NOT NULL,
	"fileIdentifier" varchar(255) NOT NULL,
	"stagingSessionId" varchar(36),
	"origin" varchar(80) DEFAULT 'API Oracle' NOT NULL,
	"responsible" varchar(120) DEFAULT 'Agendamento Periódico' NOT NULL,
	"rowsImported" integer DEFAULT 0 NOT NULL,
	"projectCount" integer DEFAULT 0 NOT NULL,
	"processedProjectCount" integer DEFAULT 0 NOT NULL,
	"activitiesImported" integer DEFAULT 0 NOT NULL,
	"processingCursor" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'analisada' NOT NULL,
	"progressPct" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"previousStateKey" varchar(512),
	"affectedProjectCodesJson" text,
	"message" text,
	"heartbeatAt" timestamp,
	"workerToken" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"publishedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "oracle_sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"ppsaCode" varchar(80) NOT NULL,
	"description" varchar(255) NOT NULL,
	"process" varchar(120) NOT NULL,
	"subprocess" varchar(120) NOT NULL,
	"activity" varchar(120) NOT NULL,
	"managementName" varchar(120),
	"moduleName" varchar(80) NOT NULL,
	"plannedStart" varchar(10) NOT NULL,
	"plannedEnd" varchar(10) NOT NULL,
	"actualStart" varchar(10),
	"actualEnd" varchar(10),
	"plannedHours" numeric(8, 2) DEFAULT '0.00' NOT NULL,
	"actualHours" numeric(8, 2) DEFAULT '0.00' NOT NULL,
	"plannedActivityHours" numeric(10, 2),
	"actualAtomicHours" numeric(10, 2),
	"actualConsolidatedHours" numeric(10, 2),
	"progressPct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"resource" varchar(120),
	"location" varchar(40) DEFAULT 'Presencial',
	"level" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) DEFAULT 'nao_iniciado' NOT NULL,
	"sourceRowNumber" integer,
	"sourceCronogramId" integer,
	"sourcePpsaId" integer,
	"parentPpsaId" integer,
	"managementCode" integer,
	"sourceProjectCode" integer,
	"sourceProcessCode" integer,
	"sourceSubprocessCode" integer,
	"sourceActivityCode" integer,
	"levelChild" varchar(80),
	"levelParent" varchar(80),
	"plannedDays" numeric(10, 2),
	"plannedWeeks" numeric(10, 2),
	"plannedModuleHours" numeric(10, 2),
	"moduleActualHours" numeric(10, 2),
	"moduleSummaryPlannedHours" numeric(10, 2),
	"moduleSummaryActualHours" numeric(10, 2),
	"moduleSummaryCompletionPct" numeric(10, 2),
	"managementSummaryPlannedHours" numeric(12, 2),
	"managementSummaryActualHours" numeric(12, 2),
	"managementSummaryCompletionPct" numeric(10, 2),
	"utilizationPct" numeric(12, 6),
	"utilizationPctLevel" numeric(12, 6),
	"totalUtilizationLevel" numeric(12, 6),
	"plannedHoursText" varchar(32),
	"elapsedSchedulePct" numeric(10, 2),
	"hoursCompletionPct" numeric(10, 2),
	"hoursOverrunStatus" varchar(160),
	"sourceStatus" varchar(40),
	"sourceRecordType" varchar(30),
	"moduleActualEndDate" varchar(10),
	"standardDuration" varchar(32),
	"plannedMorningStart" varchar(8),
	"plannedMorningEnd" varchar(8),
	"plannedAfternoonStart" varchar(8),
	"plannedAfternoonEnd" varchar(8),
	"sourceFileName" varchar(255),
	"sourceSheet" varchar(80),
	"importedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "project_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"storageKey" varchar(255),
	"storageUrl" varchar(512),
	"sourceSheet" varchar(80) NOT NULL,
	"rowsRead" integer NOT NULL,
	"rowsImported" integer NOT NULL,
	"projectCount" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"notes" text,
	"validationSummary" text,
	"importedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_risks" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(80) DEFAULT 'Cronograma' NOT NULL,
	"severity" varchar(32) DEFAULT 'medio' NOT NULL,
	"probability" varchar(32) DEFAULT 'medio' NOT NULL,
	"impact" text NOT NULL,
	"mitigationPlan" text NOT NULL,
	"owner" varchar(120) NOT NULL,
	"dueDate" varchar(10),
	"status" varchar(32) DEFAULT 'aberto' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"resolvedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "project_risks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"client" varchar(255) NOT NULL,
	"managerName" varchar(120) NOT NULL,
	"managerCode" integer,
	"managerEmail" varchar(255),
	"sponsor" varchar(120),
	"projectType" varchar(80) DEFAULT 'Não informado' NOT NULL,
	"projectTypeDescription" varchar(160),
	"isActive" boolean DEFAULT true NOT NULL,
	"sourcePhaseCode" varchar(40),
	"segmentId" integer,
	"scopeDate" varchar(10),
	"closedFlag" varchar(8),
	"status" varchar(32) DEFAULT 'sem_classificacao' NOT NULL,
	"ragSource" varchar(32) DEFAULT 'nao_disponivel' NOT NULL,
	"indicatorQuality" varchar(32) DEFAULT 'nao_disponivel' NOT NULL,
	"stage" varchar(80) DEFAULT 'Execução' NOT NULL,
	"startDate" varchar(10) NOT NULL,
	"plannedEndDate" varchar(10) NOT NULL,
	"actualStartDate" varchar(10) DEFAULT 'Sem data' NOT NULL,
	"actualEndDate" varchar(10) DEFAULT 'Sem data' NOT NULL,
	"finalDate" varchar(10) DEFAULT 'Sem data' NOT NULL,
	"projectedEndDate" varchar(10) NOT NULL,
	"baselineHours" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"plannedHours" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"actualHours" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"plannedHoursInSchedule" numeric(10, 2),
	"plannedHoursOutsideSchedule" numeric(10, 2),
	"productiveActualHours" numeric(10, 2),
	"unproductiveActualHours" numeric(10, 2),
	"hoursMetricsSource" varchar(80),
	"completionPct" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"spi" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"cpi" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"totalModules" integer DEFAULT 0 NOT NULL,
	"totalActivities" integer DEFAULT 0 NOT NULL,
	"activeConsultants" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "s_curve_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"snapshotMonth" varchar(7) NOT NULL,
	"moduleName" varchar(80) DEFAULT 'todos' NOT NULL,
	"snapshotName" varchar(160) NOT NULL,
	"isBaseline" boolean DEFAULT false NOT NULL,
	"totalPlannedHours" numeric(10, 1) DEFAULT '0.0' NOT NULL,
	"totalActualHours" numeric(10, 1) DEFAULT '0.0' NOT NULL,
	"pointsJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "s_curve_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spreadsheet_import_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" varchar(36) NOT NULL,
	"chunkIndex" integer NOT NULL,
	"rowCount" integer NOT NULL,
	"rowsJson" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spreadsheet_import_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spreadsheet_import_sessions" (
	"sessionId" varchar(36) PRIMARY KEY NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"notes" text,
	"totalChunks" integer NOT NULL,
	"totalRows" integer NOT NULL,
	"status" varchar(32) DEFAULT 'recebendo' NOT NULL,
	"progressPct" integer DEFAULT 0 NOT NULL,
	"resultBatchId" integer,
	"projectsUpdated" integer DEFAULT 0 NOT NULL,
	"activitiesImported" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spreadsheet_import_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_project_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"projectId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_project_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(32) DEFAULT 'user' NOT NULL,
	"profileRole" varchar(32) DEFAULT 'cliente' NOT NULL,
	"passwordHash" varchar(255),
	"status" varchar(32) DEFAULT 'pendente' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weekly_update_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"weeklyUpdateId" integer NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"storageUrl" varchar(512) NOT NULL,
	"contentType" varchar(160) NOT NULL,
	"fileSize" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_update_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weekly_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"weekReference" varchar(80) NOT NULL,
	"authorName" varchar(120) NOT NULL,
	"authorRole" varchar(60) DEFAULT 'Gerente de Projetos' NOT NULL,
	"ragStatus" varchar(32) NOT NULL,
	"physicalProgressPct" numeric(5, 2) NOT NULL,
	"spiValue" numeric(4, 2) NOT NULL,
	"cpiValue" numeric(4, 2) NOT NULL,
	"hoursConsumedWeek" numeric(8, 2) DEFAULT '0.00' NOT NULL,
	"whatOccurred" text NOT NULL,
	"nextSteps" text NOT NULL,
	"criticalAttention" text,
	"clientDecisionsNeeded" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weekly_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_module_unique" ON "daily_module_snapshots" USING btree ("snapshotDate","projectId","managementName","moduleName");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_project_unique" ON "daily_project_snapshots" USING btree ("snapshotDate","projectId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_project_unique" ON "user_project_access" USING btree ("userId","projectId");