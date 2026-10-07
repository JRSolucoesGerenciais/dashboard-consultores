ALTER TABLE `project_activities` ADD `moduleSummaryPlannedHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `moduleSummaryActualHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `moduleSummaryCompletionPct` decimal(10,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `managementSummaryPlannedHours` decimal(12,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `managementSummaryActualHours` decimal(12,2);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `managementSummaryCompletionPct` decimal(10,2);