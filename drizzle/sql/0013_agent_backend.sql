ALTER TABLE members ADD COLUMN agent_name text NOT NULL DEFAULT 'Agent', ADD COLUMN voice boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE workspaces ADD COLUMN default_delivery_lead_id uuid, ADD COLUMN won_stage_id text;
--> statement-breakpoint
ALTER TABLE workspaces ADD FOREIGN KEY(workspace_id,default_delivery_lead_id) REFERENCES members(workspace_id,id);
--> statement-breakpoint
ALTER TABLE memories ADD COLUMN big boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE agent_cards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 member_id uuid NOT NULL, thread_id uuid NOT NULL, draft jsonb NOT NULL, approval_id uuid,
 revision integer NOT NULL DEFAULT 1, note text,
 FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id),
 FOREIGN KEY(workspace_id,thread_id) REFERENCES agent_threads(workspace_id,id),
 FOREIGN KEY(workspace_id,approval_id) REFERENCES approvals(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE mcp_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 member_id uuid NOT NULL, name text NOT NULL, token_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 window_start timestamptz NOT NULL DEFAULT now(), requests integer NOT NULL DEFAULT 0,
 FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE agent_ai_usage (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 member_id uuid NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, calls integer NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id,member_id,day), FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 member_id uuid NOT NULL, message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 page_path text NOT NULL, app_version text NOT NULL, picture bytea, picture_type text,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,member_id) REFERENCES members(workspace_id,id),
 CHECK(picture IS NULL OR octet_length(picture)<=2097152),
 CHECK((picture IS NULL AND picture_type IS NULL) OR (picture IS NOT NULL AND picture_type IN ('image/png','image/jpeg','image/webp')))
);
--> statement-breakpoint

DO $$ DECLARE t text; rule text; BEGIN
 FOREACH t IN ARRAY ARRAY['agent_cards','mcp_tokens','agent_ai_usage','feedback'] LOOP
 rule:=CASE WHEN t='agent_cards' THEN 'member_id=app_member_id() AND app_thread(workspace_id,thread_id)' WHEN t='feedback' THEN '(member_id=app_member_id() OR (''admin''=ANY(app_roles(workspace_id)) AND NOT (''client_reviewer''=ANY(app_roles(workspace_id)))))' ELSE 'member_id=app_member_id()' END;
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY base_access ON %I AS PERMISSIVE FOR ALL TO soldline_app USING (true) WITH CHECK (true)',t);
 EXECUTE format('CREATE POLICY workspace_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (cardinality(app_roles(workspace_id))>0) WITH CHECK (cardinality(app_roles(workspace_id))>0)',t);
 EXECUTE format('CREATE POLICY access_guard ON %I AS RESTRICTIVE FOR ALL TO soldline_app USING (%s) WITH CHECK (%s)',t,rule,rule);
 END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON agent_cards,agent_ai_usage TO soldline_app;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE(revoked_at) ON mcp_tokens TO soldline_app;
--> statement-breakpoint
GRANT SELECT,INSERT ON feedback TO soldline_app;
--> statement-breakpoint
CREATE POLICY feedback_insert ON feedback AS RESTRICTIVE FOR INSERT TO soldline_app WITH CHECK(member_id=app_member_id());
--> statement-breakpoint
GRANT INSERT,UPDATE ON agent_threads,agent_messages TO soldline_app;
--> statement-breakpoint
GRANT UPDATE(preferred_name,language,digest_time,agent_name,voice) ON members TO soldline_app;
--> statement-breakpoint
CREATE POLICY settings_member_update ON members AS RESTRICTIVE FOR UPDATE TO soldline_app USING(id=app_member_id()) WITH CHECK(id=app_member_id());
--> statement-breakpoint
GRANT UPDATE(name,timezone,default_delivery_lead_id,won_stage_id,working_days) ON workspaces TO soldline_app;
--> statement-breakpoint
CREATE POLICY settings_company_update ON workspaces AS RESTRICTIVE FOR UPDATE TO soldline_app USING('admin'=ANY(app_roles(id))) WITH CHECK('admin'=ANY(app_roles(id)));
--> statement-breakpoint

CREATE FUNCTION agent_reserve_ai(cap integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m members; demo boolean; n integer; BEGIN
 SELECT * INTO m FROM members WHERE id=app_member_id() AND archived_at IS NULL;
 IF m.id IS NULL OR cap<1 THEN RETURN false; END IF;
 SELECT is_demo INTO demo FROM workspaces WHERE id=m.workspace_id AND (NOT coalesce(is_demo,false) OR demo_expires_at>now());
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(m.workspace_id::text||':agent_ai',0));
 SELECT coalesce(sum(calls),0) INTO n FROM agent_ai_usage WHERE workspace_id=m.workspace_id AND day=CURRENT_DATE AND (coalesce(demo,false) OR member_id=m.id);
 IF n>=cap THEN RETURN false; END IF;
 INSERT INTO agent_ai_usage(workspace_id,member_id,calls) VALUES(m.workspace_id,m.id,1) ON CONFLICT(workspace_id,member_id,day) DO UPDATE SET calls=agent_ai_usage.calls+1;
 RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_reserve_ai(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_reserve_ai(integer) TO soldline_app;
--> statement-breakpoint


ALTER POLICY access_guard ON memories USING ((scope='person' AND member_id=app_member_id()) OR (scope='org' AND NOT ('client_reviewer'=ANY(app_roles(workspace_id))))) WITH CHECK ((scope='person' AND member_id=app_member_id()) OR (scope='org' AND NOT ('client_reviewer'=ANY(app_roles(workspace_id)))));
--> statement-breakpoint
