ALTER TABLE connections ADD COLUMN poll_cursor text;
--> statement-breakpoint
ALTER TABLE connections ADD COLUMN won_stage_id text;
--> statement-breakpoint
ALTER TABLE connections ADD COLUMN delivery_lead_id uuid;
--> statement-breakpoint
ALTER TABLE connections ADD CONSTRAINT connection_delivery_lead FOREIGN KEY (workspace_id,delivery_lead_id) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN delivery_lead_id uuid;
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN plus_address text;
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN mail_thread_ids text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE runs ADD CONSTRAINT run_delivery_lead FOREIGN KEY (workspace_id,delivery_lead_id) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE inbound_events ADD COLUMN run_id uuid;
--> statement-breakpoint
ALTER TABLE inbound_events ADD CONSTRAINT event_run FOREIGN KEY (workspace_id,run_id) REFERENCES runs(workspace_id,id);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN lock_token uuid;
--> statement-breakpoint
ALTER TABLE recovery_items ALTER COLUMN run_id DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_one_per_job ON recovery_items(workspace_id,job_id) WHERE job_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX jobs_ready ON jobs(next_attempt_at) WHERE status IN ('queued','running','failed');
--> statement-breakpoint
-- Only the private owner services may append system actors. Request members cannot call this function.
CREATE FUNCTION audit_system_append(ws uuid, actor text, event jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
DECLARE entry audit_log;
BEGIN
  IF actor NOT IN ('webhook','schedule','system') THEN RAISE EXCEPTION 'System actor required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(ws::text,0));
  entry := jsonb_populate_record(NULL::audit_log,event);
  entry.id := nextval('audit_log_id_seq');
  entry.workspace_id := ws;
  entry.at := clock_timestamp();
  entry.actor_type := actor;
  entry.actor_member_id := NULL;
  entry.actor_name_at_event := NULL;
  entry.actor_roles_at_event := NULL;
  SELECT row_hash INTO entry.prev_hash FROM audit_log WHERE workspace_id=ws ORDER BY id DESC LIMIT 1;
  entry.row_hash := audit_row_hash(entry);
  INSERT INTO audit_log SELECT (entry).*;
  RETURN entry.id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_system_append(uuid,text,jsonb) FROM PUBLIC, soldline_app;
--> statement-breakpoint
DROP POLICY access_guard ON recovery_items;
--> statement-breakpoint
CREATE POLICY access_guard ON recovery_items AS RESTRICTIVE FOR ALL TO soldline_app
  USING (app_run(workspace_id,run_id) OR (run_id IS NULL AND app_staff(workspace_id)))
  WITH CHECK (app_run(workspace_id,run_id) OR (run_id IS NULL AND app_staff(workspace_id)));
