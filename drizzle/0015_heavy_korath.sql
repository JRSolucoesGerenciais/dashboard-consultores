ALTER TABLE `project_activities` ADD `hoursOverrunStatus` varchar(160);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `sourceStatus` varchar(40);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `moduleActualEndDate` varchar(10);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `standardDuration` varchar(32);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedMorningStart` varchar(8);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedMorningEnd` varchar(8);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedAfternoonStart` varchar(8);--> statement-breakpoint
ALTER TABLE `project_activities` ADD `plannedAfternoonEnd` varchar(8);--> statement-breakpoint
ALTER TABLE `projects` ADD `managerCode` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `segmentId` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `scopeDate` varchar(10);--> statement-breakpoint
ALTER TABLE `projects` ADD `closedFlag` varchar(8);