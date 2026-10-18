ALTER TABLE monitor_tasks ADD COLUMN client_approved_at timestamptz;
--> statement-breakpoint
ALTER TABLE monitor_tasks ADD COLUMN client_approved_by uuid;
--> statement-breakpoint
ALTER TABLE monitor_tasks ADD CONSTRAINT client_review_member FOREIGN KEY(workspace_id,client_approved_by) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE monitor_tasks ADD CONSTRAINT client_review_pair CHECK ((client_approved_at IS NULL) = (client_approved_by IS NULL));
