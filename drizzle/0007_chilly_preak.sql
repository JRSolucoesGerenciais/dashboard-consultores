ALTER TABLE `project_activities` ADD `managementName` varchar(120);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `levelChild` varchar(80);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `levelParent` varchar(80);--> statement-breakpoint
ALTER TABLE `projects` ADD `finalDate` varchar(10) DEFAULT 'Sem data' NOT NULL;