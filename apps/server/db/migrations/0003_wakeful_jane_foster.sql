CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
