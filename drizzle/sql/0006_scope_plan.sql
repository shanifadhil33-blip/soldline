ALTER TABLE scope_documents ADD COLUMN pages jsonb;
--> statement-breakpoint
ALTER TABLE line_items ADD COLUMN cadence text CHECK (cadence IN ('once','monthly','weekly'));
--> statement-breakpoint
ALTER TABLE deliverable_mappings ADD COLUMN synonyms jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE deliverable_mappings ADD COLUMN due_offset_days integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE deliverable_mappings ADD COLUMN clickup_list_id text;
--> statement-breakpoint
ALTER TABLE deals ADD COLUMN contract_start_date date;
