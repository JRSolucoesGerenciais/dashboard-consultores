CREATE TABLE `weekly_update_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weeklyUpdateId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`storageUrl` varchar(512) NOT NULL,
	`contentType` varchar(160) NOT NULL,
	`fileSize` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weekly_update_attachments_id` PRIMARY KEY(`id`)
);
