CREATE FUNCTION audit_canonical(entry audit_log) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
  SELECT (to_jsonb(entry) - 'prev_hash' - 'row_hash')::text
$$;
--> statement-breakpoint
-- JSON timestamps must have the same representation during append and verification.
CREATE FUNCTION audit_row_hash(entry audit_log) RETURNS text LANGUAGE sql STABLE
SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
  SELECT encode(sha256(convert_to(coalesce(entry.prev_hash,'') || audit_canonical(entry), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION audit_append(ws uuid, event jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
DECLARE entry audit_log; member members;
BEGIN
  IF cardinality(app_roles(ws)) = 0 THEN RAISE EXCEPTION 'Workspace access refused'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(ws::text, 0));
  SELECT * INTO member FROM members WHERE workspace_id = ws AND id = app_member_id() AND archived_at IS NULL;
  entry := jsonb_populate_record(NULL::audit_log, event);
  entry.id := nextval('audit_log_id_seq');
  entry.workspace_id := ws;
  entry.at := clock_timestamp();
  entry.actor_type := 'user';
  entry.actor_member_id := member.id;
  entry.actor_name_at_event := member.display_name;
  entry.actor_roles_at_event := member.roles;
  SELECT row_hash INTO entry.prev_hash FROM audit_log WHERE workspace_id = ws ORDER BY id DESC LIMIT 1;
  entry.row_hash := audit_row_hash(entry);
  INSERT INTO audit_log SELECT (entry).*;
  RETURN entry.id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_canonical(audit_log), audit_row_hash(audit_log), audit_append(uuid,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_canonical(audit_log), audit_row_hash(audit_log), audit_append(uuid,jsonb) TO soldline_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM soldline_app;
--> statement-breakpoint
