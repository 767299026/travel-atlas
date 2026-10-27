CREATE TABLE `photo_memories` (
	`media_id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`taken_on` varchar(10),
	`place` json,
	`note` text NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `photo_memories_media_id` PRIMARY KEY(`media_id`)
);
--> statement-breakpoint
CREATE TABLE `photo_group_notes` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`group_key` varchar(500) NOT NULL,
	`note` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `photo_group_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `photo_note_owner_group_uq` UNIQUE(`owner_id`,`group_key`)
);
--> statement-breakpoint
ALTER TABLE `photo_memories` ADD CONSTRAINT `photo_memories_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `photo_memories` ADD CONSTRAINT `photo_memories_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `photo_group_notes` ADD CONSTRAINT `photo_group_notes_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `photo_owner_date_idx` ON `photo_memories` (`owner_id`,`taken_on`);