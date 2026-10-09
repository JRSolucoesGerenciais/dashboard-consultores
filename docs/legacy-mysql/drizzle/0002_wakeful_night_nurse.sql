CREATE TABLE `project_import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`sourceSheet` varchar(80) NOT NULL,
	`rowsRead` int NOT NULL,
	`rowsImported` int NOT NULL,
	`projectCount` int NOT NULL,
	`status` enum('sucesso','parcial','erro') NOT NULL,
	`notes` text,
	`importedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceRowNumber` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceCronogramId` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourcePpsaId` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `managementCode` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceProjectCode` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceProcessCode` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceSubprocessCode` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceActivityCode` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedDays` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedHoursText` varchar(32);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `elapsedSchedulePct` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `hoursCompletionPct` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceFileName` varchar(255);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceSheet` varchar(80);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `importedAt` timestamp;