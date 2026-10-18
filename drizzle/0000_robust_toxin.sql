CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "accounts_provider_unique" UNIQUE("workspace_id","provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_messages_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "agent_messages_role_check" CHECK ("agent_messages"."role" in ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_threads_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_by_type" text,
	"requested_by_member_id" uuid,
	"required_roles" text[],
	"status" text,
	"payload" jsonb,
	"payload_hash" text,
	"input_refs" jsonb,
	"input_hash" text,
	"reversibility" text,
	"expires_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_at" timestamp with time zone,
	"execution_summary" jsonb,
	"stale_reason" text,
	CONSTRAINT "approvals_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "approvals_kind_check" CHECK ("approvals"."kind" in ('plan_correction', 'provision', 'client_email', 'scope_change', 'reversal')),
	CONSTRAINT "approvals_requested_by_type_check" CHECK ("approvals"."requested_by_type" in ('user', 'agent')),
	CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'rejected', 'expired', 'stale', 'executing', 'executed', 'cancelled')),
	CONSTRAINT "approvals_reversibility_check" CHECK ("approvals"."reversibility" in ('reversible', 'cancellable', 'irreversible'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now(),
	"actor_type" text NOT NULL,
	"actor_member_id" uuid,
	"actor_name_at_event" text,
	"actor_roles_at_event" text[],
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"approval_id" uuid,
	"effect_id" uuid,
	"request_id" text,
	"prev_hash" text,
	"row_hash" text NOT NULL,
	CONSTRAINT "audit_log_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" in ('user', 'agent', 'webhook', 'schedule', 'system')),
	CONSTRAINT "audit_log_outcome_check" CHECK ("audit_log"."outcome" in ('allowed', 'denied', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "client_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hubspot_company_id" text,
	CONSTRAINT "client_companies_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"account_label" text,
	"external_account_id" text,
	"scopes" text[],
	"token_ciphertext" text,
	"refresh_ciphertext" text,
	"expires_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error_code" text,
	"allowed_actions" jsonb,
	CONSTRAINT "connections_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "connections_provider_check" CHECK ("connections"."provider" in ('hubspot', 'clickup', 'mail')),
	CONSTRAINT "connections_status_check" CHECK ("connections"."status" in ('connected', 'needs_reconnect', 'paused', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_company_id" uuid NOT NULL,
	"hubspot_deal_id" text NOT NULL,
	"name" text NOT NULL,
	"stage" text,
	"amount" numeric,
	"currency" text,
	"owner_member_id" uuid,
	"close_date" date,
	"hs_modified_at" timestamp with time zone,
	"snapshot" jsonb,
	"snapshot_hash" text,
	CONSTRAINT "deals_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "deals_hubspot_deal_id_unique" UNIQUE("workspace_id","hubspot_deal_id")
);
--> statement-breakpoint
CREATE TABLE "deliverable_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"match_sku" text,
	"match_title_normalised" text,
	"template_list" text,
	"task_title" text,
	"default_role" text,
	"estimate_minutes" integer,
	"status" text,
	"learned_from_run_id" uuid,
	CONSTRAINT "deliverable_mappings_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "deliverable_mappings_status_check" CHECK ("deliverable_mappings"."status" in ('active', 'waiting_approval'))
);
--> statement-breakpoint
CREATE TABLE "external_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"approval_id" uuid,
	"effect_key" text NOT NULL,
	"system" text,
	"action" text,
	"target_ref" text,
	"request" jsonb,
	"request_hash" text,
	"state" text,
	"external_id" text,
	"attempts" integer,
	"last_error_code" text,
	"reversibility" text,
	"compensates_effect_id" uuid,
	CONSTRAINT "external_effects_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "external_effects_effect_key_unique" UNIQUE("workspace_id","effect_key"),
	CONSTRAINT "external_effects_state_check" CHECK ("external_effects"."state" in ('planned', 'in_flight', 'succeeded', 'failed', 'unknown', 'compensated', 'cancelled')),
	CONSTRAINT "external_effects_reversibility_check" CHECK ("external_effects"."reversibility" in ('reversible', 'cancellable', 'irreversible'))
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text,
	"title" text,
	"evidence" jsonb,
	"status" text,
	"owner_member_id" uuid,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "findings_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "findings_kind_check" CHECK ("findings"."kind" in ('scope_mismatch', 'missing_input', 'contradiction', 'overdue_client_approval', 'deadline_risk', 'scope_change_request', 'no_owner', 'unusual_instruction')),
	CONSTRAINT "findings_severity_check" CHECK ("findings"."severity" in ('block', 'warn', 'info')),
	CONSTRAINT "findings_status_check" CHECK ("findings"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_type" text,
	"external_object_id" text,
	"raw" jsonb,
	"signature_ok" boolean,
	"received_via" text,
	"received_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"result" text,
	CONSTRAINT "inbound_events_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "inbound_events_dedupe_key_unique" UNIQUE("workspace_id","dedupe_key"),
	CONSTRAINT "inbound_events_source_check" CHECK ("inbound_events"."source" in ('hubspot', 'clickup', 'mail', 'replay')),
	CONSTRAINT "inbound_events_received_via_check" CHECK ("inbound_events"."received_via" in ('webhook', 'reconcile', 'poll', 'replay'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text,
	"payload" jsonb,
	"run_id" uuid,
	"dedupe_key" text,
	"status" text,
	"attempts" integer,
	"max_attempts" integer DEFAULT 5,
	"next_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "jobs_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("workspace_id","dedupe_key"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'done', 'failed', 'dead'))
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"hubspot_line_item_id" text,
	"name" text,
	"sku" text,
	"quantity" numeric,
	"price" numeric,
	"hs_modified_at" timestamp with time zone,
	"snapshot_hash" text,
	CONSTRAINT "line_items_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"preferred_name" text,
	"language" text,
	"roles" text[] NOT NULL,
	"client_company_id" uuid,
	"hubspot_owner_id" text,
	"clickup_user_id" text,
	"email" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "members_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "members_language_check" CHECK ("members"."language" in ('en', 'ar')),
	CONSTRAINT "members_roles_check" CHECK ("members"."roles" <@ ARRAY['admin','account_manager','delivery_lead','contributor','client_reviewer']::text[]),
	CONSTRAINT "members_company_check" CHECK (("members"."client_company_id" is null) = (not ('client_reviewer' = any("members"."roles"))))
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"member_id" uuid,
	"kind" text,
	"text" text,
	"based_on" jsonb,
	"based_on_count" integer,
	"status" text,
	CONSTRAINT "memories_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "memories_scope_check" CHECK ("memories"."scope" in ('person', 'org')),
	CONSTRAINT "memories_kind_check" CHECK ("memories"."kind" in ('preference', 'client_preference', 'decision', 'mapping')),
	CONSTRAINT "memories_status_check" CHECK ("memories"."status" in ('active', 'waiting_approval')),
	CONSTRAINT "memories_owner_check" CHECK ("memories"."scope" <> 'person' or "memories"."member_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text,
	"label" text,
	"status" text,
	"requested_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"source_message_id" uuid,
	"evidence" jsonb,
	CONSTRAINT "onboarding_inputs_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "onboarding_inputs_status_check" CHECK ("onboarding_inputs"."status" in ('missing', 'received', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "recovery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid,
	"effect_id" uuid,
	"finding_id" uuid,
	"kind" text,
	"title" text,
	"plain_reason" text,
	"owner_member_id" uuid,
	"status" text,
	"allowed_options" text[],
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "recovery_items_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "recovery_items_status_check" CHECK ("recovery_items"."status" in ('open', 'retrying', 'resolved', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"run_key" text NOT NULL,
	"status" text NOT NULL,
	"trigger_event_id" uuid,
	"scope_version_id" uuid,
	"plan" jsonb,
	"plan_hash" text,
	"won_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "runs_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "runs_run_key_unique" UNIQUE("workspace_id","run_key"),
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('received', 'analysing', 'blocked', 'waiting_approval', 'executing', 'partly_done', 'ready', 'in_delivery', 'paused', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "scope_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"source" text NOT NULL,
	"hubspot_file_id" text,
	"filename" text,
	"sha256" text,
	"page_count" integer,
	"text" text,
	"received_at" timestamp with time zone,
	CONSTRAINT "scope_documents_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "scope_documents_source_check" CHECK ("scope_documents"."source" in ('hubspot_note', 'upload'))
);
--> statement-breakpoint
CREATE TABLE "scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope_version_id" uuid NOT NULL,
	"key" text,
	"title" text,
	"quantity" numeric,
	"cadence" text,
	"due_rule" text,
	"source_page" integer,
	"source_quote" text,
	"method" text,
	"confidence" numeric,
	CONSTRAINT "scope_items_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "scope_items_cadence_check" CHECK ("scope_items"."cadence" in ('once', 'monthly', 'weekly')),
	CONSTRAINT "scope_items_method_check" CHECK ("scope_items"."method" in ('parser', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "scope_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"source_document_id" uuid,
	"items_hash" text,
	"reason" text,
	"created_by" uuid,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "scope_versions_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "scope_versions_version_unique" UNIQUE("workspace_id","deal_id","version"),
	CONSTRAINT "scope_versions_status_check" CHECK ("scope_versions"."status" in ('draft', 'accepted', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "sessions_session_token_unique" UNIQUE("workspace_id","session_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "verification_tokens_token_unique" UNIQUE("workspace_id","token")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_demo" boolean,
	"demo_expires_at" timestamp with time zone,
	"timezone" text DEFAULT 'Asia/Dubai',
	"currency" text DEFAULT 'AED',
	CONSTRAINT "workspaces_workspace_id_id" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_user_id_users_workspace_id_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."users"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_workspace_id_thread_id_agent_threads_workspace_id_id_fk" FOREIGN KEY ("workspace_id","thread_id") REFERENCES "public"."agent_threads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_workspace_id_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_workspace_id_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_requested_by_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","requested_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_decided_by_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","decided_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_actor_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","actor_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_approval_id_approvals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_effect_id_external_effects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","effect_id") REFERENCES "public"."external_effects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_client_company_id_client_companies_workspace_id_id_fk" FOREIGN KEY ("workspace_id","client_company_id") REFERENCES "public"."client_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_owner_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_mappings" ADD CONSTRAINT "deliverable_mappings_workspace_id_learned_from_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","learned_from_run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_mappings" ADD CONSTRAINT "deliverable_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspace_id_approval_id_approvals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","approval_id") REFERENCES "public"."approvals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspace_id_compensates_effect_id_external_effects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","compensates_effect_id") REFERENCES "public"."external_effects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_owner_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_resolved_by_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","resolved_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_workspace_id_deal_id_deals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_user_id_users_workspace_id_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."users"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_client_company_id_client_companies_workspace_id_id_fk" FOREIGN KEY ("workspace_id","client_company_id") REFERENCES "public"."client_companies"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_inputs" ADD CONSTRAINT "onboarding_inputs_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_inputs" ADD CONSTRAINT "onboarding_inputs_workspace_id_source_message_id_agent_messages_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_message_id") REFERENCES "public"."agent_messages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_inputs" ADD CONSTRAINT "onboarding_inputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_run_id_runs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_job_id_jobs_workspace_id_id_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "public"."jobs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_effect_id_external_effects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","effect_id") REFERENCES "public"."external_effects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_finding_id_findings_workspace_id_id_fk" FOREIGN KEY ("workspace_id","finding_id") REFERENCES "public"."findings"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_owner_member_id_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","owner_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_resolved_by_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","resolved_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_items" ADD CONSTRAINT "recovery_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_deal_id_deals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_trigger_event_id_inbound_events_workspace_id_id_fk" FOREIGN KEY ("workspace_id","trigger_event_id") REFERENCES "public"."inbound_events"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_scope_version_id_scope_versions_workspace_id_id_fk" FOREIGN KEY ("workspace_id","scope_version_id") REFERENCES "public"."scope_versions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_documents" ADD CONSTRAINT "scope_documents_workspace_id_deal_id_deals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_documents" ADD CONSTRAINT "scope_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_workspace_id_scope_version_id_scope_versions_workspace_id_id_fk" FOREIGN KEY ("workspace_id","scope_version_id") REFERENCES "public"."scope_versions"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_workspace_id_deal_id_deals_workspace_id_id_fk" FOREIGN KEY ("workspace_id","deal_id") REFERENCES "public"."deals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_workspace_id_source_document_id_scope_documents_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_document_id") REFERENCES "public"."scope_documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_workspace_id_created_by_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","created_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_workspace_id_accepted_by_members_workspace_id_id_fk" FOREIGN KEY ("workspace_id","accepted_by") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_user_id_users_workspace_id_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."users"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;