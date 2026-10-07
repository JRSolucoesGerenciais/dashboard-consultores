CREATE TABLE `project_activities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`ppsaCode` varchar(80) NOT NULL,
	`description` varchar(255) NOT NULL,
	`process` varchar(120) NOT NULL,
	`subprocess` varchar(120) NOT NULL,
	`activity` varchar(120) NOT NULL,
	`moduleName` varchar(80) NOT NULL,
	`plannedStart` varchar(10) NOT NULL,
	`plannedEnd` varchar(10) NOT NULL,
	`actualStart` varchar(10),
	`actualEnd` varchar(10),
	`plannedHours` decimal(8,2) NOT NULL DEFAULT '0.00',
	`actualHours` decimal(8,2) NOT NULL DEFAULT '0.00',
	`progressPct` decimal(5,2) NOT NULL DEFAULT '0.00',
	`resource` varchar(120),
	`location` varchar(40) DEFAULT 'Presencial',
	`level` int NOT NULL DEFAULT 1,
	`status` enum('nao_iniciado','em_andamento','concluido','atrasado') NOT NULL DEFAULT 'nao_iniciado',
	CONSTRAINT `project_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_risks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`category` varchar(80) NOT NULL DEFAULT 'Cronograma',
	`severity` enum('baixo','medio','alto','critico') NOT NULL DEFAULT 'medio',
	`probability` enum('baixo','medio','alto') NOT NULL DEFAULT 'medio',
	`impact` text NOT NULL,
	`mitigationPlan` text NOT NULL,
	`owner` varchar(120) NOT NULL,
	`dueDate` varchar(10),
	`status` enum('aberto','em_mitigacao','resolvido') NOT NULL DEFAULT 'aberto',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `project_risks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`client` varchar(255) NOT NULL,
	`managerName` varchar(120) NOT NULL,
	`managerEmail` varchar(255),
	`sponsor` varchar(120),
	`status` enum('verde','amarelo','vermelho') NOT NULL DEFAULT 'verde',
	`stage` varchar(80) NOT NULL DEFAULT 'Execução',
	`startDate` varchar(10) NOT NULL,
	`plannedEndDate` varchar(10) NOT NULL,
	`projectedEndDate` varchar(10) NOT NULL,
	`baselineHours` decimal(10,2) NOT NULL DEFAULT '0.00',
	`plannedHours` decimal(10,2) NOT NULL DEFAULT '0.00',
	`actualHours` decimal(10,2) NOT NULL DEFAULT '0.00',
	`completionPct` decimal(5,2) NOT NULL DEFAULT '0.00',
	`spi` decimal(4,2) NOT NULL DEFAULT '1.00',
	`cpi` decimal(4,2) NOT NULL DEFAULT '1.00',
	`totalModules` int NOT NULL DEFAULT 0,
	`totalActivities` int NOT NULL DEFAULT 0,
	`activeConsultants` int NOT NULL DEFAULT 0,
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `weekly_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`weekReference` varchar(20) NOT NULL,
	`authorName` varchar(120) NOT NULL,
	`authorRole` varchar(60) NOT NULL DEFAULT 'Gerente de Projetos',
	`ragStatus` enum('verde','amarelo','vermelho') NOT NULL,
	`physicalProgressPct` decimal(5,2) NOT NULL,
	`spiValue` decimal(4,2) NOT NULL,
	`cpiValue` decimal(4,2) NOT NULL,
	`hoursConsumedWeek` decimal(8,2) NOT NULL DEFAULT '0.00',
	`whatOccurred` text NOT NULL,
	`nextSteps` text NOT NULL,
	`criticalAttention` text,
	`clientDecisionsNeeded` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weekly_updates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `profileRole` enum('diretoria','pmo','gerente','consultor','cliente') DEFAULT 'gerente' NOT NULL;