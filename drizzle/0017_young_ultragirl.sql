ALTER TABLE `oracle_sync_runs` ADD `progressPct` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `errorMessage` text;