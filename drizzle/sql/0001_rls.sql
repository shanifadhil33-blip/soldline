DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'soldline_app') THEN
    CREATE ROLE soldline_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE soldline_app NOBYPASSRLS;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO soldline_app;
--> statement-breakpoint

CREATE FUNCTION app_member_id() RETURNS uuid LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT nullif(current_setting('app.member_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION app_roles(ws uuid) RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT roles FROM members WHERE workspace_id = ws
    AND id = app_member_id() AND archived_at IS NULL), ARRAY[]::text[])
$$;
--> statement-breakpoint
CREATE FUNCTION app_client_company(ws uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT client_company_id FROM members WHERE workspace_id = ws
    AND id = app_member_id() AND archived_at IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION app_staff(ws uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, pg_temp AS $$
  SELECT app_roles(ws) && ARRAY['admin','account_manager','delivery_lead']
    AND NOT ('client_reviewer' = ANY(app_roles(ws)))
$$;
--> statement-breakpoint
CREATE FUNCTION app_deal(ws uuid, deal uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM deals d WHERE d.workspace_id = ws AND d.id = deal
    AND cardinality(app_roles(ws)) > 0 AND
    CASE WHEN 'client_reviewer' = ANY(app_roles(ws)) THEN d.client_company_id = app_client_company(ws)
    ELSE app_staff(ws) OR EXISTS(SELECT FROM runs r WHERE r.workspace_id = ws AND r.deal_id = d.id AND
      (EXISTS(SELECT FROM findings f WHERE f.workspace_id = ws AND f.run_id = r.id AND f.owner_member_id = app_member_id())
      OR EXISTS(SELECT FROM recovery_items x WHERE x.workspace_id = ws AND x.run_id = r.id AND x.owner_member_id = app_member_id()))) END)
$$;
--> statement-breakpoint
CREATE FUNCTION app_run(ws uuid, run uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM runs r JOIN deals d ON d.id = r.deal_id AND d.workspace_id = ws
    WHERE r.workspace_id = ws AND r.id = run AND cardinality(app_roles(ws)) > 0 AND
    CASE WHEN 'client_reviewer' = ANY(app_roles(ws)) THEN d.client_company_id = app_client_company(ws)
    ELSE app_staff(ws) OR EXISTS(SELECT FROM findings f WHERE f.workspace_id = ws AND f.run_id = r.id AND f.owner_member_id = app_member_id())
      OR EXISTS(SELECT FROM recovery_items x WHERE x.workspace_id = ws AND x.run_id = r.id AND x.owner_member_id = app_member_id()) END)
$$;
--> statement-breakpoint
CREATE FUNCTION app_scope_version(ws uuid, version_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM scope_versions v WHERE v.workspace_id = ws AND v.id = version_id AND app_deal(ws,v.deal_id))
$$;
--> statement-breakpoint
CREATE FUNCTION app_thread(ws uuid, thread uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT FROM agent_threads t WHERE t.workspace_id = ws AND t.id = thread AND t.member_id = app_member_id())
$$;
--> statement-breakpoint
DO $$
DECLARE t text; access_rule text; ws text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    ws := CASE WHEN t = 'workspaces' THEN 'id' ELSE 'workspace_id' END;
    access_rule := CASE
      WHEN t = 'workspaces' THEN 'workspace_id = id'
      WHEN t = 'members' THEN 'app_staff(workspace_id) OR id = app_member_id()'
      WHEN t = 'users' THEN 'EXISTS(SELECT FROM members m WHERE m.workspace_id = users.workspace_id AND m.user_id = users.id AND m.id = app_member_id())'
      WHEN t IN ('accounts','sessions') THEN 'EXISTS(SELECT FROM members m WHERE m.workspace_id = ' || t || '.workspace_id AND m.user_id = ' || t || '.user_id AND m.id = app_member_id())'
      WHEN t = 'verification_tokens' THEN 'false'
      WHEN t = 'client_companies' THEN 'app_staff(workspace_id) OR id = app_client_company(workspace_id)'
      WHEN t IN ('connections','jobs','inbound_events','external_effects','deliverable_mappings') THEN 'app_staff(workspace_id)'
      WHEN t = 'deals' THEN 'app_deal(workspace_id,id)'
      WHEN t IN ('line_items','scope_documents','scope_versions') THEN 'app_deal(workspace_id,deal_id)'
      WHEN t = 'scope_items' THEN 'app_scope_version(workspace_id,scope_version_id)'
      WHEN t = 'runs' THEN 'app_run(workspace_id,id)'
      WHEN t IN ('onboarding_inputs','approvals','recovery_items') THEN 'app_run(workspace_id,run_id)'
      WHEN t = 'findings' THEN 'app_run(workspace_id,run_id) AND (kind <> ''unusual_instruction'' OR NOT (''client_reviewer'' = ANY(app_roles(workspace_id))))'
      WHEN t = 'memories' THEN '(scope = ''person'' AND member_id = app_member_id()) OR (scope = ''org'' AND NOT (''client_reviewer'' = ANY(app_roles(workspace_id))))'
      WHEN t = 'agent_threads' THEN 'member_id = app_member_id()'
      WHEN t = 'agent_messages' THEN 'member_id = app_member_id() AND app_thread(workspace_id,thread_id)'
      WHEN t = 'notifications' THEN 'member_id = app_member_id()'
      WHEN t = 'audit_log' THEN 'app_staff(workspace_id) AND (''admin'' = ANY(app_roles(workspace_id)) OR (target_type = ''run'' AND EXISTS(SELECT FROM runs r JOIN deals d ON d.workspace_id = r.workspace_id AND d.id = r.deal_id WHERE r.workspace_id = audit_log.workspace_id AND r.id::text = audit_log.target_id AND d.owner_member_id = app_member_id())))'
      ELSE 'false' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY base_access ON %I AS PERMISSIVE FOR ALL TO soldline_app USING (true) WITH CHECK (true)',t);
    EXECUTE format('CREATE POLICY workspace_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (cardinality(app_roles(%s)) > 0) WITH CHECK (cardinality(app_roles(%s)) > 0)',t,ws,ws);
    EXECUTE format('CREATE POLICY access_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (%s) WITH CHECK (%s)',t,access_rule,access_rule);
    -- Reads are available through the policies. Mutations are granted only to explicit server functions in later phases.
    EXECUTE format('GRANT SELECT ON %I TO soldline_app',t);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_member_id(), app_roles(uuid), app_client_company(uuid), app_staff(uuid), app_deal(uuid,uuid), app_run(uuid,uuid), app_scope_version(uuid,uuid), app_thread(uuid,uuid) TO soldline_app;
--> statement-breakpoint
