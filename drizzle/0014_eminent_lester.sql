ALTER TABLE `spreadsheet_import_sessions` MODIFY COLUMN `status` enum('recebendo','processando','concluida','erro','expirada') NOT NULL DEFAULT 'recebendo';--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `progressPct` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `resultBatchId` int;--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `projectsUpdated` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `activitiesImported` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `errorMessage` text;--> statement-breakpoint
ALTER TABLE `spreadsheet_import_sessions` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;