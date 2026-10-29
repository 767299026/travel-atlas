ALTER TABLE `route_days` ADD `is_unscheduled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `journeys` ADD `planning_preferences` json;