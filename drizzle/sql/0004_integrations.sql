CREATE TABLE demo_faults (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL CHECK (provider IN ('hubspot','clickup','mail')),
  fail_next integer NOT NULL DEFAULT 0 CHECK (fail_next >= 0),
  mode text NOT NULL CHECK (mode IN ('outage','revoked')),
  PRIMARY KEY (workspace_id,provider)
);
--> statement-breakpoint
CREATE TABLE rate_buckets (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  provider text NOT NULL CHECK (provider IN ('hubspot','clickup')),
  bucket_key text NOT NULL,
  tokens numeric NOT NULL CHECK (tokens >= 0 AND tokens <= 100),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (provider,bucket_key)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['demo_faults','rate_buckets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY base_access ON %I AS PERMISSIVE FOR ALL TO soldline_app USING (true) WITH CHECK (true)',t);
    EXECUTE format('CREATE POLICY workspace_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (cardinality(app_roles(workspace_id)) > 0) WITH CHECK (cardinality(app_roles(workspace_id)) > 0)',t);
    EXECUTE format('CREATE POLICY access_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (app_staff(workspace_id)) WITH CHECK (app_staff(workspace_id))',t);
    EXECUTE format('GRANT SELECT ON %I TO soldline_app',t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM soldline_app',t);
  END LOOP;
END $$;

--> statement-breakpoint
ALTER TABLE connections ADD COLUMN webhook_secrets jsonb NOT NULL DEFAULT '{}'::jsonb;

--> statement-breakpoint
CREATE UNIQUE INDEX connections_workspace_provider ON connections(workspace_id,provider);
