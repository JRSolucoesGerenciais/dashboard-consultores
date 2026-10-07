ALTER TABLE `project_import_batches` ADD `storageKey` varchar(255);--> statement-breakpoint
ALTER TABLE `project_import_batches` ADD `storageUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `project_import_batches` ADD `validationSummary` text;