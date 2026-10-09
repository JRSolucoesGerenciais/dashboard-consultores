CREATE TABLE `spreadsheet_import_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`chunkIndex` int NOT NULL,
	`rowCount` int NOT NULL,
	`rowsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spreadsheet_import_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spreadsheet_import_sessions` (
	`sessionId` varchar(36) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`notes` text,
	`totalChunks` int NOT NULL,
	`totalRows` int NOT NULL,
	`status` enum('recebendo','concluida','expirada') NOT NULL DEFAULT 'recebendo',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spreadsheet_import_sessions_sessionId` PRIMARY KEY(`sessionId`)
);
