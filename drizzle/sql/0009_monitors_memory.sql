ALTER TABLE workspaces ADD COLUMN working_days integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4] CHECK (cardinality(working_days)>0 AND working_days <@ ARRAY[0,1,2,3,4,5,6]);
--> statement-breakpoint
ALTER TABLE members ADD COLUMN digest_time time NOT NULL DEFAULT '09:00';
--> statement-breakpoint
ALTER TABLE onboarding_inputs ADD COLUMN blocking boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE findings ADD COLUMN monitor_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX finding_monitor_key ON findings(workspace_id,run_id,monitor_key) WHERE monitor_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_one_per_finding ON recovery_items(workspace_id,finding_id) WHERE finding_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE memories ADD COLUMN deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE memories ADD COLUMN confirmed_by uuid;
--> statement-breakpoint
ALTER TABLE memories ADD CONSTRAINT memory_confirmer FOREIGN KEY(workspace_id,confirmed_by) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE memories ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE memories ADD COLUMN history jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN dedupe_key text;
--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN actor_member_id uuid;
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notification_actor FOREIGN KEY(workspace_id,actor_member_id) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE notifications ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE UNIQUE INDEX notification_dedupe ON notifications(workspace_id,member_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE monitor_tasks (
  workspace_id uuid NOT NULL, run_id uuid NOT NULL, task_id text NOT NULL,
  status text NOT NULL, review_since timestamptz, due_at timestamptz,
  scope_item_id uuid, assignee_ids text[] NOT NULL DEFAULT '{}', closed boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL, PRIMARY KEY(workspace_id,run_id,task_id),
  FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id),
  FOREIGN KEY(workspace_id,scope_item_id) REFERENCES scope_items(workspace_id,id)
);
--> statement-breakpoint
ALTER TABLE monitor_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE monitor_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY base_access ON monitor_tasks AS PERMISSIVE FOR ALL TO soldline_app USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE POLICY workspace_guard ON monitor_tasks AS RESTRICTIVE FOR ALL TO soldline_app USING(cardinality(app_roles(workspace_id))>0) WITH CHECK(cardinality(app_roles(workspace_id))>0);
--> statement-breakpoint
CREATE POLICY access_guard ON monitor_tasks AS RESTRICTIVE FOR ALL TO soldline_app USING(app_run(workspace_id,run_id)) WITH CHECK(app_run(workspace_id,run_id));
--> statement-breakpoint
GRANT SELECT ON monitor_tasks TO soldline_app;
--> statement-breakpoint
CREATE VIEW run_metrics WITH (security_invoker=true) AS
SELECT r.workspace_id,r.id AS run_id,
 CASE WHEN r.ready_at>=r.won_at THEN extract(epoch FROM (r.ready_at-r.won_at))/3600 END AS won_to_ready_hours,
 (SELECT max(extract(epoch FROM (now()-i.requested_at))/86400) FROM onboarding_inputs i WHERE i.workspace_id=r.workspace_id AND i.run_id=r.id AND i.status='missing') AS oldest_missing_input_days,
 (SELECT count(*) FROM scope_items s JOIN scope_versions v ON v.workspace_id=s.workspace_id AND v.id=s.scope_version_id WHERE v.workspace_id=r.workspace_id AND v.id=r.scope_version_id AND v.status='accepted' AND NOT EXISTS(SELECT 1 FROM monitor_tasks t WHERE t.workspace_id=r.workspace_id AND t.run_id=r.id AND t.scope_item_id=s.id AND cardinality(t.assignee_ids)>0)) AS commitments_without_owner
FROM runs r;
--> statement-breakpoint
GRANT SELECT ON run_metrics TO soldline_app;
--> statement-breakpoint
ALTER POLICY access_guard ON memories USING (
  (scope='person' AND member_id=app_member_id()) OR
  (scope='org' AND 'admin'=ANY(app_roles(workspace_id)) AND NOT ('client_reviewer'=ANY(app_roles(workspace_id))))
) WITH CHECK (
  (scope='person' AND member_id=app_member_id()) OR
  (scope='org' AND 'admin'=ANY(app_roles(workspace_id)) AND NOT ('client_reviewer'=ANY(app_roles(workspace_id))))
);
