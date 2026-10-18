ALTER TABLE external_effects ADD COLUMN parent_effect_id uuid;
--> statement-breakpoint
ALTER TABLE external_effects ADD COLUMN result jsonb;
--> statement-breakpoint
ALTER TABLE external_effects ADD CONSTRAINT effect_parent FOREIGN KEY(workspace_id,parent_effect_id) REFERENCES external_effects(workspace_id,id);
--> statement-breakpoint
ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK(status IN ('queued','running','done','failed','dead','cancelled'));

--> statement-breakpoint
CREATE UNIQUE INDEX one_running_executor_per_run ON jobs(workspace_id,run_id) WHERE kind='execute_approval_effect' AND status='running';
