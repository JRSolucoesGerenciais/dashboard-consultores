ALTER TABLE `projects` ADD `projectType` varchar(80) DEFAULT 'Não informado' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sourcePhaseCode` varchar(40);