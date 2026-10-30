ALTER TABLE `clients_table` ADD `upload_limit_mbps` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients_table` ADD `download_limit_mbps` real DEFAULT 0 NOT NULL;