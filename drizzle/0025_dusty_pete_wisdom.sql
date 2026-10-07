ALTER TABLE `project_activities` ADD `plannedActivityHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `actualAtomicHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `actualConsolidatedHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `parentPpsaId` int;--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceRecordType` varchar(30);