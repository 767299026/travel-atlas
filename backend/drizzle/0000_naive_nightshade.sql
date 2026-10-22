CREATE TABLE `route_days` (
	`id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`sort_order` int NOT NULL,
	`title` varchar(80) NOT NULL,
	`area` varchar(120) NOT NULL,
	`local_date` varchar(10),
	`stay_name` varchar(160) NOT NULL,
	CONSTRAINT `route_days_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `journeys` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`title` varchar(80) NOT NULL,
	`destinations` json NOT NULL,
	`status` enum('planning','completed','archived') NOT NULL DEFAULT 'planning',
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `journeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`scope` varchar(100) NOT NULL,
	`mutation_key` varchar(80) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`response` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `idempotency_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `mutations_owner_scope_key_uq` UNIQUE(`owner_id`,`scope`,`mutation_key`)
);
--> statement-breakpoint
CREATE TABLE `route_revisions` (
	`id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`snapshot` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `route_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `revisions_route_version_uq` UNIQUE(`route_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `journey_routes` (
	`id` varchar(36) NOT NULL,
	`journey_id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`layer` enum('plan','actual') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`note` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `journey_routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `routes_journey_layer_uq` UNIQUE(`journey_id`,`layer`)
);
--> statement-breakpoint
CREATE TABLE `route_segments` (
	`id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`from_stop_id` varchar(36) NOT NULL,
	`to_stop_id` varchar(36) NOT NULL,
	`kind` enum('travel','gap') NOT NULL,
	`mode` varchar(20) NOT NULL,
	`geometry_status` enum('missing','ready','stale') NOT NULL DEFAULT 'missing',
	`review_status` enum('unreviewed','needs_attention','confirmed') NOT NULL DEFAULT 'unreviewed',
	`geometry_ref` varchar(36),
	`geometry_locked` boolean NOT NULL DEFAULT false,
	CONSTRAINT `route_segments_id` PRIMARY KEY(`id`),
	CONSTRAINT `segments_route_pair_uq` UNIQUE(`route_id`,`from_stop_id`,`to_stop_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`csrf_token` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `route_stops` (
	`id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`day_id` varchar(36) NOT NULL,
	`sort_order` int NOT NULL,
	`label` varchar(160) NOT NULL,
	`region` varchar(120) NOT NULL,
	`local_time` varchar(5),
	`note` text NOT NULL,
	`role` enum('departure','visit','waypoint','transfer','overnight') NOT NULL,
	`location` json,
	CONSTRAINT `route_stops_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`username` varchar(64) NOT NULL,
	`display_name` varchar(80) NOT NULL,
	`password_hash` varchar(256) NOT NULL,
	`role` varchar(20) NOT NULL DEFAULT 'owner',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_uq` UNIQUE(`username`)
);
--> statement-breakpoint
ALTER TABLE `route_days` ADD CONSTRAINT `route_days_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journeys` ADD CONSTRAINT `journeys_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_records` ADD CONSTRAINT `idempotency_records_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_revisions` ADD CONSTRAINT `route_revisions_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_revisions` ADD CONSTRAINT `route_revisions_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journey_routes` ADD CONSTRAINT `journey_routes_journey_id_journeys_id_fk` FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journey_routes` ADD CONSTRAINT `journey_routes_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_segments` ADD CONSTRAINT `route_segments_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_segments` ADD CONSTRAINT `route_segments_from_stop_id_route_stops_id_fk` FOREIGN KEY (`from_stop_id`) REFERENCES `route_stops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_segments` ADD CONSTRAINT `route_segments_to_stop_id_route_stops_id_fk` FOREIGN KEY (`to_stop_id`) REFERENCES `route_stops`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_day_id_route_days_id_fk` FOREIGN KEY (`day_id`) REFERENCES `route_days`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `days_route_order_idx` ON `route_days` (`route_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `journeys_owner_created_idx` ON `journeys` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mutations_expiry_idx` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE INDEX `routes_owner_idx` ON `journey_routes` (`owner_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `stops_day_order_idx` ON `route_stops` (`day_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `stops_route_idx` ON `route_stops` (`route_id`);