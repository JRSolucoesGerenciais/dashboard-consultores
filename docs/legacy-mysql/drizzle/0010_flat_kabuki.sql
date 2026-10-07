CREATE TABLE `s_curve_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`snapshotMonth` varchar(7) NOT NULL,
	`moduleName` varchar(80) NOT NULL DEFAULT 'todos',
	`snapshotName` varchar(160) NOT NULL,
	`isBaseline` boolean NOT NULL DEFAULT false,
	`totalPlannedHours` decimal(10,1) NOT NULL DEFAULT '0.0',
	`totalActualHours` decimal(10,1) NOT NULL DEFAULT '0.0',
	`pointsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `s_curve_snapshots_id` PRIMARY KEY(`id`)
);
