CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`action` varchar(40) NOT NULL,
	`target_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `diaries` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`title` varchar(120) NOT NULL,
	`occurred_on` varchar(10),
	`body` text NOT NULL,
	`status` enum('draft','written') NOT NULL,
	`association` json,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `diaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `diary_photos` (
	`id` varchar(36) NOT NULL,
	`diary_id` varchar(36) NOT NULL,
	`media_id` varchar(36) NOT NULL,
	`sort_order` int NOT NULL,
	`caption` varchar(1000) NOT NULL,
	CONSTRAINT `diary_photos_id` PRIMARY KEY(`id`),
	CONSTRAINT `diary_photos_media_uq` UNIQUE(`media_id`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`filename` varchar(200) NOT NULL,
	`extension` varchar(8) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`original_bytes` int NOT NULL,
	`stored_bytes` int NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`state` enum('ready','deleted') NOT NULL DEFAULT 'ready',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`journey_id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`stop_id` varchar(36) NOT NULL,
	`label` varchar(160) NOT NULL,
	`region` varchar(120) NOT NULL,
	`visited_on` varchar(10) NOT NULL,
	`note` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `visits_id` PRIMARY KEY(`id`),
	CONSTRAINT `visits_owner_stop_uq` UNIQUE(`owner_id`,`stop_id`)
);
--> statement-breakpoint
ALTER TABLE `route_days` ADD `copied_from` json;--> statement-breakpoint
ALTER TABLE `journey_routes` ADD `copied_from` json;--> statement-breakpoint
ALTER TABLE `route_stops` ADD `copied_from` json;--> statement-breakpoint
ALTER TABLE `users` ADD `version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `diaries` ADD CONSTRAINT `diaries_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `diary_photos` ADD CONSTRAINT `diary_photos_diary_id_diaries_id_fk` FOREIGN KEY (`diary_id`) REFERENCES `diaries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `diary_photos` ADD CONSTRAINT `diary_photos_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visits` ADD CONSTRAINT `visits_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visits` ADD CONSTRAINT `visits_journey_id_journeys_id_fk` FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `visits` ADD CONSTRAINT `visits_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `diaries_owner_created_idx` ON `diaries` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `diary_photos_order_idx` ON `diary_photos` (`diary_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `media_owner_state_idx` ON `media` (`owner_id`,`state`);--> statement-breakpoint
CREATE INDEX `visits_owner_journey_idx` ON `visits` (`owner_id`,`journey_id`);