CREATE TABLE `geometry_assets` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`source_kind` enum('manual','imported_reference') NOT NULL,
	`source_note` text NOT NULL,
	`geometry` json NOT NULL,
	`samples` json,
	`point_count` int NOT NULL,
	`length_m` double NOT NULL,
	`export_policy` enum('allowed','unverified') NOT NULL,
	`filename` varchar(200),
	`original_xml` mediumtext,
	`checksum` varchar(64) NOT NULL,
	`diagnostics` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `geometry_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `geometry_assets` ADD CONSTRAINT `geometry_assets_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `geometry_assets` ADD CONSTRAINT `geometry_assets_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `geometry_owner_route_idx` ON `geometry_assets` (`owner_id`,`route_id`);