CREATE TABLE `share_links` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`journey_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`snapshot` json NOT NULL,
	`bindings` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	CONSTRAINT `share_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_journey_id_journeys_id_fk` FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `share_owner_journey_idx` ON `share_links` (`owner_id`,`journey_id`);--> statement-breakpoint
CREATE INDEX `share_expiry_idx` ON `share_links` (`expires_at`);