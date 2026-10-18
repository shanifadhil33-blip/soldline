ALTER TABLE approvals ADD COLUMN decisions jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE approvals ADD COLUMN confirmed_by uuid;
--> statement-breakpoint
ALTER TABLE approvals ADD COLUMN confirmed_at timestamptz;
--> statement-breakpoint
ALTER TABLE approvals ADD CONSTRAINT approval_confirmer FOREIGN KEY(workspace_id,confirmed_by) REFERENCES members(workspace_id,id);
--> statement-breakpoint
CREATE INDEX approvals_open_inputs ON approvals USING gin(input_refs) WHERE status IN ('pending','approved');
--> statement-breakpoint
CREATE FUNCTION approval_watch_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a record; reason text; event_time text;
BEGIN
  IF NEW.source NOT IN ('hubspot','clickup') THEN RETURN NEW; END IF;
  event_time := to_char(coalesce(NEW.received_at,now()) AT TIME ZONE 'UTC','DD Mon YYYY HH24:MI:SS') || ' UTC';
  FOR a IN SELECT id FROM approvals p WHERE p.workspace_id=NEW.workspace_id AND p.status IN ('pending','approved') AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.input_refs) ref WHERE
      (NEW.source='hubspot' AND ref->>'system' IN ('hubspot','hubspot_line_item') AND ref->>'record_id'=NEW.external_object_id)
      OR (NEW.source='clickup' AND ref->>'system'='clickup' AND
        (NEW.raw->>'list_id' IS NULL OR ref->>'record_id'=NEW.raw->>'list_id'))
  ) FOR UPDATE LOOP
    reason := CASE NEW.source WHEN 'hubspot' THEN 'HubSpot record changed at ' ELSE 'ClickUp target list may have changed at ' END || event_time;
    UPDATE approvals SET status='stale',stale_reason=reason WHERE workspace_id=NEW.workspace_id AND id=a.id;
    PERFORM audit_system_append(NEW.workspace_id,CASE WHEN NEW.received_via='webhook' THEN 'webhook' ELSE 'schedule' END,
      jsonb_build_object('action','approval_stale','outcome','succeeded','target_type','approval','target_id',a.id,'approval_id',a.id,'after',jsonb_build_object('reason',reason)));
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION approval_watch_event() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER approval_event_changed AFTER INSERT ON inbound_events FOR EACH ROW EXECUTE FUNCTION approval_watch_event();
--> statement-breakpoint
CREATE FUNCTION approval_watch_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a record; reason text;
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  reason := 'Scope version changed at ' || to_char(now() AT TIME ZONE 'UTC','DD Mon YYYY HH24:MI:SS') || ' UTC';
  FOR a IN SELECT id FROM approvals p WHERE p.workspace_id=NEW.workspace_id AND p.status IN ('pending','approved') AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.input_refs) ref WHERE ref->>'system'='scope' AND ref->>'record_id'=NEW.deal_id::text
  ) FOR UPDATE LOOP
    UPDATE approvals SET status='stale',stale_reason=reason WHERE workspace_id=NEW.workspace_id AND id=a.id;
    PERFORM audit_system_append(NEW.workspace_id,'system',jsonb_build_object('action','approval_stale','outcome','succeeded','target_type','approval','target_id',a.id,'approval_id',a.id,'after',jsonb_build_object('reason',reason)));
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION approval_watch_scope() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER approval_scope_changed AFTER INSERT OR UPDATE ON scope_versions FOR EACH ROW EXECUTE FUNCTION approval_watch_scope();
