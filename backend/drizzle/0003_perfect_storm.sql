CREATE TABLE `routing_candidates` (
	`id` varchar(36) NOT NULL,
	`job_id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`segment_id` varchar(36) NOT NULL,
	`input` json NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`geometry` json NOT NULL,
	`info` json NOT NULL,
	`length_m` double NOT NULL,
	`diagnostics` json NOT NULL,
	`adopted_asset_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `routing_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `routing_candidate_job_uq` UNIQUE(`job_id`)
);
--> statement-breakpoint
CREATE TABLE `routing_jobs` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(36) NOT NULL,
	`route_id` varchar(36) NOT NULL,
	`segment_id` varchar(36) NOT NULL,
	`status` enum('queued','running','succeeded','failed','cancelled','obsolete') NOT NULL,
	`input` json NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`candidate_id` varchar(36),
	`failure_code` varchar(50),
	`failure_message` varchar(300),
	`lease_token` varchar(36),
	`lease_expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `routing_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `geometry_assets` MODIFY COLUMN `source_kind` enum('manual','imported_reference','routing') NOT NULL;--> statement-breakpoint
ALTER TABLE `geometry_assets` ADD `routing_info` json;--> statement-breakpoint
ALTER TABLE `routing_candidates` ADD CONSTRAINT `routing_candidates_job_id_routing_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `routing_jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routing_candidates` ADD CONSTRAINT `routing_candidates_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routing_candidates` ADD CONSTRAINT `routing_candidates_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routing_jobs` ADD CONSTRAINT `routing_jobs_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routing_jobs` ADD CONSTRAINT `routing_jobs_route_id_journey_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `journey_routes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `routing_candidate_owner_idx` ON `routing_candidates` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `routing_job_status_idx` ON `routing_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `routing_job_owner_idx` ON `routing_jobs` (`owner_id`,`created_at`);