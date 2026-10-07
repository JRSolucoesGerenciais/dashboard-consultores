ALTER TABLE `oracle_sync_runs` ADD `stagingSessionId` varchar(36);--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `processedProjectCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `activitiesImported` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `processingCursor` int DEFAULT 0 NOT NULL;