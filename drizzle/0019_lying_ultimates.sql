ALTER TABLE `oracle_sync_runs` MODIFY COLUMN `status` enum('publicada_ativa','publicada','erro','analisada','processando') NOT NULL DEFAULT 'analisada';--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `heartbeatAt` timestamp;--> statement-breakpoint
ALTER TABLE `oracle_sync_runs` ADD `workerToken` varchar(64);