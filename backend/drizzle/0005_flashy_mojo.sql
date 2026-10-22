CREATE TABLE `place_records` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`kind` enum('visited','wish') NOT NULL,
	`place_key` varchar(40) NOT NULL,
	`place` json NOT NULL,
	`visited_on` varchar(10),
	`note` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `place_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `visits` ADD `place` json;--> statement-breakpoint
ALTER TABLE `visits` ADD `location` json;--> statement-breakpoint
ALTER TABLE `visits` ADD `version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `place_records` ADD CONSTRAINT `place_records_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `place_owner_kind_idx` ON `place_records` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `place_owner_key_idx` ON `place_records` (`owner_id`,`place_key`);