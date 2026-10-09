ALTER TABLE `projects` ADD `plannedHoursInSchedule` decimal(10,2);--> statement-breakpoint
ALTER TABLE `projects` ADD `plannedHoursOutsideSchedule` decimal(10,2);--> statement-breakpoint
ALTER TABLE `projects` ADD `productiveActualHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `projects` ADD `unproductiveActualHours` decimal(10,2);--> statement-breakpoint
ALTER TABLE `projects` ADD `hoursMetricsSource` varchar(80);