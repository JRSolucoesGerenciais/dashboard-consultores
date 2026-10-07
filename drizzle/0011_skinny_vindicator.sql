CREATE TABLE `oracle_api_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`endpointUrl` varchar(512) NOT NULL,
	`syncIntervalMinutes` int NOT NULL DEFAULT 180,
	`backgroundEnabled` boolean NOT NULL DEFAULT false,
	`lastAttemptAt` timestamp,
	`lastSuccessAt` timestamp,
	`lastStatus` enum('conectado','sincronizado','erro','nao_testado') NOT NULL DEFAULT 'nao_testado',
	`lastMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oracle_api_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oracle_sync_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`configId` int NOT NULL DEFAULT 1,
	`fileIdentifier` varchar(255) NOT NULL,
	`origin` varchar(80) NOT NULL DEFAULT 'API Oracle',
	`responsible` varchar(120) NOT NULL DEFAULT 'Agendamento Periódico',
	`rowsImported` int NOT NULL DEFAULT 0,
	`projectCount` int NOT NULL DEFAULT 0,
	`status` enum('publicada_ativa','publicada','erro','analisada') NOT NULL DEFAULT 'analisada',
	`previousStateKey` varchar(512),
	`affectedProjectCodesJson` text,
	`message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`publishedAt` timestamp,
	CONSTRAINT `oracle_sync_runs_id` PRIMARY KEY(`id`)
);
