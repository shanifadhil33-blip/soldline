CREATE TABLE sample_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  run_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
  message_id text NOT NULL, thread_id text NOT NULL, raw jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Sample, not sent', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id) ON DELETE CASCADE, UNIQUE(workspace_id,message_id)
);
--> statement-breakpoint
CREATE TABLE demo_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL CHECK(provider IN ('clickup','hubspot')), external_id text NOT NULL,
  seed_state jsonb NOT NULL DEFAULT '{}', cleaned_at timestamptz, origin_effect_id uuid,
  FOREIGN KEY(workspace_id,origin_effect_id) REFERENCES external_effects(workspace_id,id),
  UNIQUE(workspace_id,provider,external_id)
);
--> statement-breakpoint
ALTER TABLE sample_mail ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sample_mail FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE demo_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE demo_resources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY base_access ON sample_mail AS PERMISSIVE FOR ALL TO soldline_app USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE POLICY access_guard ON sample_mail AS RESTRICTIVE FOR ALL TO soldline_app USING(app_staff(workspace_id) AND app_run(workspace_id,run_id)) WITH CHECK(app_staff(workspace_id) AND app_run(workspace_id,run_id));
--> statement-breakpoint
CREATE POLICY base_access ON demo_resources AS PERMISSIVE FOR ALL TO soldline_app USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE POLICY access_guard ON demo_resources AS RESTRICTIVE FOR ALL TO soldline_app USING(app_staff(workspace_id) AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=demo_resources.workspace_id AND w.is_demo)) WITH CHECK(app_staff(workspace_id) AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=demo_resources.workspace_id AND w.is_demo));
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON sample_mail,demo_resources TO soldline_app;
--> statement-breakpoint
-- Deleting an expired sandbox removes its own dependent rows in one statement.
-- Audit rows are removed by the workspace cascade, never by an application audit write.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,conrelid::regclass AS tbl,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid='workspaces'::regclass LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',c.tbl,c.conname,regexp_replace(c.definition,' ON DELETE [A-Z ]+$',''));
 END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE demo_faults ADD COLUMN operation text;

--> statement-breakpoint
ALTER TABLE monitor_tasks ADD CONSTRAINT monitor_tasks_workspace FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

--> statement-breakpoint
CREATE POLICY workspace_guard ON sample_mail AS RESTRICTIVE FOR ALL TO soldline_app USING(cardinality(app_roles(workspace_id))>0) WITH CHECK(cardinality(app_roles(workspace_id))>0);
--> statement-breakpoint
CREATE POLICY workspace_guard ON demo_resources AS RESTRICTIVE FOR ALL TO soldline_app USING(cardinality(app_roles(workspace_id))>0) WITH CHECK(cardinality(app_roles(workspace_id))>0);
--> statement-breakpoint
-- App writes must prove the folder was created by an actual successful effect.
-- HubSpot ownership and cleanup progress remain private owner operations.
CREATE POLICY resource_insert_proof ON demo_resources AS RESTRICTIVE FOR INSERT TO soldline_app WITH CHECK(provider='clickup' AND cleaned_at IS NULL AND seed_state='{}'::jsonb AND EXISTS(SELECT 1 FROM external_effects e WHERE e.workspace_id=demo_resources.workspace_id AND e.id=origin_effect_id AND e.external_id=demo_resources.external_id AND e.action='create_folder' AND e.system='clickup' AND e.state='succeeded' AND e.parent_effect_id IS NOT NULL));
--> statement-breakpoint
CREATE POLICY resource_update_proof ON demo_resources AS RESTRICTIVE FOR UPDATE TO soldline_app USING(provider='clickup' AND origin_effect_id IS NOT NULL) WITH CHECK(provider='clickup' AND cleaned_at IS NULL AND seed_state='{}'::jsonb AND EXISTS(SELECT 1 FROM external_effects e WHERE e.workspace_id=demo_resources.workspace_id AND e.id=origin_effect_id AND e.external_id=demo_resources.external_id AND e.action='create_folder' AND e.system='clickup' AND e.state='succeeded' AND e.parent_effect_id IS NOT NULL));
