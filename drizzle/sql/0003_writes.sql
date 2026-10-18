ALTER TABLE workspaces ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
-- Demo members have no authentication identity.
ALTER TABLE members ALTER COLUMN user_id DROP NOT NULL;
--> statement-breakpoint
CREATE FUNCTION identity_workspace_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE demo boolean;
BEGIN
  SELECT coalesce(is_demo,false) INTO demo FROM workspaces WHERE id = NEW.workspace_id;
  IF TG_TABLE_NAME = 'members' THEN
    IF demo <> (NEW.user_id IS NULL) THEN RAISE EXCEPTION 'Member identity refused'; END IF;
  ELSIF demo THEN RAISE EXCEPTION 'Demo authentication refused';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity_workspace_guard() FROM PUBLIC, soldline_app;
--> statement-breakpoint
CREATE TRIGGER member_identity_guard BEFORE INSERT OR UPDATE ON members FOR EACH ROW EXECUTE FUNCTION identity_workspace_guard();
--> statement-breakpoint
CREATE TRIGGER user_identity_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION identity_workspace_guard();
--> statement-breakpoint
CREATE TRIGGER account_identity_guard BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION identity_workspace_guard();
--> statement-breakpoint
CREATE TRIGGER session_identity_guard BEFORE INSERT OR UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION identity_workspace_guard();
--> statement-breakpoint
-- Only onboarding input writes are granted. Other features await their own approved mutations.
GRANT INSERT, UPDATE ON onboarding_inputs TO soldline_app;
--> statement-breakpoint
CREATE POLICY input_insert_guard ON onboarding_inputs AS RESTRICTIVE FOR INSERT TO soldline_app
  WITH CHECK (app_run(workspace_id,run_id));
--> statement-breakpoint
CREATE POLICY input_update_guard ON onboarding_inputs AS RESTRICTIVE FOR UPDATE TO soldline_app
  USING (app_run(workspace_id,run_id)) WITH CHECK (app_run(workspace_id,run_id));
--> statement-breakpoint
-- Owner operations live exclusively in the server only owner module. The request role gets none.
REVOKE INSERT, UPDATE, DELETE ON workspaces, users, accounts, sessions, verification_tokens, members, jobs FROM soldline_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM soldline_app;
--> statement-breakpoint
-- Several held roles grant the union of their access.
CREATE OR REPLACE FUNCTION app_staff(ws uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT app_roles(ws) && ARRAY['admin','account_manager','delivery_lead']
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_run(ws uuid, run uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=ws
    WHERE r.workspace_id=ws AND r.id=run AND (
      app_staff(ws) OR ('client_reviewer'=ANY(app_roles(ws)) AND d.client_company_id=app_client_company(ws)) OR
      ('contributor'=ANY(app_roles(ws)) AND (
        EXISTS(SELECT FROM findings f WHERE f.workspace_id=ws AND f.run_id=r.id AND f.owner_member_id=app_member_id()) OR
        EXISTS(SELECT FROM recovery_items x WHERE x.workspace_id=ws AND x.run_id=r.id AND x.owner_member_id=app_member_id())))))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_deal(ws uuid, deal uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM deals d WHERE d.workspace_id=ws AND d.id=deal AND (
    app_staff(ws) OR ('client_reviewer'=ANY(app_roles(ws)) AND d.client_company_id=app_client_company(ws)) OR
    EXISTS(SELECT FROM runs r WHERE r.workspace_id=ws AND r.deal_id=d.id AND app_run(ws,r.id))))
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_identity ON users (email);
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_google_identity ON accounts (provider,provider_account_id) WHERE provider='google';
