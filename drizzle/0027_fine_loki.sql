CREATE TABLE `user_project_access` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_project_access_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_project_unique` UNIQUE(`userId`,`projectId`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `profileRole` enum('diretoria','pmo','gerente','consultor','cliente','coordenador') NOT NULL DEFAULT 'cliente';--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('pendente','ativo','bloqueado') DEFAULT 'pendente' NOT NULL;