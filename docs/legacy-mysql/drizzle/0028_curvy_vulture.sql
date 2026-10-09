CREATE TABLE `daily_module_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`projectId` int NOT NULL,
	`managementName` varchar(120) NOT NULL,
	`moduleName` varchar(120) NOT NULL,
	`plannedHours` decimal(12,2) NOT NULL DEFAULT '0.00',
	`actualHours` decimal(12,2) NOT NULL DEFAULT '0.00',
	`completionPct` decimal(7,2) NOT NULL DEFAULT '0.00',
	CONSTRAINT `daily_module_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_module_unique` UNIQUE(`snapshotDate`,`projectId`,`managementName`,`moduleName`)
);
--> statement-breakpoint
CREATE TABLE `daily_project_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`projectId` int NOT NULL,
	`projectCode` varchar(64) NOT NULL,
	`projectName` varchar(255) NOT NULL,
	`client` varchar(255) NOT NULL,
	`status` varchar(24) NOT NULL,
	`plannedHours` decimal(12,2) NOT NULL DEFAULT '0.00',
	`actualHours` decimal(12,2) NOT NULL DEFAULT '0.00',
	`completionPct` decimal(7,2) NOT NULL DEFAULT '0.00',
	`totalActivities` int NOT NULL DEFAULT 0,
	`syncRunId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_project_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_project_unique` UNIQUE(`snapshotDate`,`projectId`)
);
