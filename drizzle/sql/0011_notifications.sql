-- Notifications for approvals, recovery, client input, client review and connections (P14, Oct 19 2026).
-- Triggers cover every write path (stores, executor, monitors, demo seed) so no path can forget to notify.
-- The definer bypasses member RLS only to insert rows for the named staff members; client reviewers never get internal notices.
CREATE FUNCTION notify_member(ws uuid, target uuid, note_kind text, body_en text, body_ar text, note_link text, dedupe text, actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF target IS NULL OR target IS NOT DISTINCT FROM actor THEN RETURN; END IF;
  INSERT INTO notifications(workspace_id,member_id,kind,body,link,dedupe_key,actor_member_id)
  SELECT ws,m.id,note_kind,CASE WHEN m.language='ar' THEN body_ar ELSE body_en END,note_link,dedupe,actor
  FROM members m WHERE m.workspace_id=ws AND m.id=target AND m.archived_at IS NULL AND NOT ('client_reviewer'=ANY(m.roles))
  ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_member(uuid,uuid,text,text,text,text,text,uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION notify_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m record; manager uuid; requester uuid; link text;
BEGIN
  link := '/runs/' || NEW.run_id::text;
  requester := CASE WHEN NEW.requested_by_type='user' THEN NEW.requested_by_member_id END;
  IF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
    FOR m IN SELECT id FROM members WHERE workspace_id=NEW.workspace_id AND archived_at IS NULL AND roles && NEW.required_roles LOOP
      PERFORM notify_member(NEW.workspace_id,m.id,'approval','An approval is waiting for you','هناك موافقة بانتظارك',link,'approval:'||NEW.id,requester);
    END LOOP;
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status='stale' THEN
    FOR m IN SELECT id FROM members WHERE workspace_id=NEW.workspace_id AND archived_at IS NULL AND roles && NEW.required_roles LOOP
      PERFORM notify_member(NEW.workspace_id,m.id,'approval_stale','An approval is out of date. Review it again.','موافقة لم تعد محدثة. راجعها مرة أخرى.',link,'approval_stale:'||NEW.id,NULL);
    END LOOP;
  ELSIF NEW.status IN ('approved','rejected') THEN
    SELECT d.owner_member_id INTO manager FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.run_id;
    PERFORM notify_member(NEW.workspace_id,requester,'approval_decided',
      CASE NEW.status WHEN 'approved' THEN 'Your approval request was approved' ELSE 'Your approval request was rejected' END,
      CASE NEW.status WHEN 'approved' THEN 'تمت الموافقة على طلبك' ELSE 'تم رفض طلبك' END,link,'approval_decided:'||NEW.id,NEW.decided_by);
    IF manager IS DISTINCT FROM requester THEN
      PERFORM notify_member(NEW.workspace_id,manager,'approval_decided',
        CASE NEW.status WHEN 'approved' THEN 'An approval on your client was approved' ELSE 'An approval on your client was rejected' END,
        CASE NEW.status WHEN 'approved' THEN 'تمت الموافقة على طلب يخص عميلك' ELSE 'تم رفض طلب يخص عميلك' END,link,'approval_decided:'||NEW.id,NEW.decided_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_approval() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER approval_notify AFTER INSERT OR UPDATE OF status ON approvals FOR EACH ROW EXECUTE FUNCTION notify_approval();
--> statement-breakpoint
CREATE FUNCTION notify_recovery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE manager uuid; lead uuid; link text;
BEGIN
  link := '/recovery';
  IF TG_OP='INSERT' THEN
    IF NEW.status IN ('open','retrying') THEN
      PERFORM notify_member(NEW.workspace_id,NEW.owner_member_id,'recovery','Something needs fixing and it is yours','هناك أمر يحتاج إلى إصلاح وهو من مسؤوليتك',link,'recovery:'||NEW.id,NULL);
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status='resolved' THEN
    SELECT d.owner_member_id,r.delivery_lead_id INTO manager,lead FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.run_id;
    PERFORM notify_member(NEW.workspace_id,manager,'recovery_resolved','A fix on your client is done','تم إصلاح أمر يخص عميلك',link,'recovery_resolved:'||NEW.id,NEW.resolved_by);
    IF lead IS DISTINCT FROM manager THEN
      PERFORM notify_member(NEW.workspace_id,lead,'recovery_resolved','A fix on your client is done','تم إصلاح أمر يخص عميلك',link,'recovery_resolved:'||NEW.id,NEW.resolved_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_recovery() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER recovery_notify AFTER INSERT OR UPDATE OF status ON recovery_items FOR EACH ROW EXECUTE FUNCTION notify_recovery();
--> statement-breakpoint
CREATE FUNCTION notify_client_step() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE manager uuid; lead uuid; en text; ar text; dedupe text;
BEGIN
  IF TG_TABLE_NAME='onboarding_inputs' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status OR NEW.status<>'received' THEN RETURN NEW; END IF;
    en := 'The client supplied an input'; ar := 'أرسل العميل أحد المتطلبات'; dedupe := 'input_received:'||NEW.id;
  ELSE
    IF OLD.client_approved_at IS NOT NULL OR NEW.client_approved_at IS NULL THEN RETURN NEW; END IF;
    en := 'The client approved a deliverable'; ar := 'وافق العميل على أحد المخرجات'; dedupe := 'client_review:'||NEW.task_id;
  END IF;
  SELECT d.owner_member_id,r.delivery_lead_id INTO manager,lead FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.run_id;
  PERFORM notify_member(NEW.workspace_id,manager,'client_step',en,ar,'/runs/'||NEW.run_id::text,dedupe,NULL);
  IF lead IS DISTINCT FROM manager THEN PERFORM notify_member(NEW.workspace_id,lead,'client_step',en,ar,'/runs/'||NEW.run_id::text,dedupe,NULL); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_client_step() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER input_notify AFTER UPDATE OF status ON onboarding_inputs FOR EACH ROW EXECUTE FUNCTION notify_client_step();
--> statement-breakpoint
CREATE TRIGGER client_review_notify AFTER UPDATE OF client_approved_at ON monitor_tasks FOR EACH ROW EXECUTE FUNCTION notify_client_step();
--> statement-breakpoint
CREATE FUNCTION notify_connection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status OR NEW.status NOT IN ('needs_reconnect','revoked') THEN RETURN NEW; END IF;
  FOR m IN SELECT id FROM members WHERE workspace_id=NEW.workspace_id AND archived_at IS NULL AND 'admin'=ANY(roles) LOOP
    PERFORM notify_member(NEW.workspace_id,m.id,'connection','A connection needs to be reconnected','أحد الاتصالات يحتاج إلى إعادة ربط','/connections','connection:'||NEW.id||':'||to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24'),NULL);
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notify_connection() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER connection_notify AFTER UPDATE OF status ON connections FOR EACH ROW EXECUTE FUNCTION notify_connection();
--> statement-breakpoint
GRANT UPDATE (read_at) ON notifications TO soldline_app;
