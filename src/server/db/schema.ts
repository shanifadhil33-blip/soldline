import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, timestamp, integer, numeric, date, jsonb, bigserial, primaryKey, unique, uniqueIndex, index, check, foreignKey } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  is_demo: boolean('is_demo'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  demo_expires_at: timestamp('demo_expires_at', { withTimezone: true, mode: 'string' }),
  timezone: text('timezone').default('Asia/Dubai'),
  currency: text('currency').default('AED')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('workspaces_workspace_id_id').on(t.workspace_id, t.id),
  check('workspaces_identity_check', sql`${t.workspace_id} = ${t.id}`)
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  name: text('name'),
  email: text('email').notNull(),
  email_verified: timestamp('email_verified', { withTimezone: true, mode: 'string' }),
  image: text('image')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('users_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  user_id: uuid('user_id').notNull(),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  provider_account_id: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('accounts_workspace_id_id').on(t.workspace_id, t.id),
  unique('accounts_provider_unique').on(t.workspace_id, t.provider, t.provider_account_id),
  foreignKey({ columns: [t.workspace_id, t.user_id], foreignColumns: [users.workspace_id, users.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  session_token: text('session_token').notNull(),
  user_id: uuid('user_id').notNull(),
  expires: timestamp('expires', { withTimezone: true, mode: 'string' }).notNull()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('sessions_workspace_id_id').on(t.workspace_id, t.id),
  unique('sessions_session_token_unique').on(t.workspace_id, t.session_token),
  foreignKey({ columns: [t.workspace_id, t.user_id], foreignColumns: [users.workspace_id, users.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const verification_tokens = pgTable('verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { withTimezone: true, mode: 'string' }).notNull()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('verification_tokens_workspace_id_id').on(t.workspace_id, t.id),
  unique('verification_tokens_token_unique').on(t.workspace_id, t.token),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  user_id: uuid('user_id'),
  display_name: text('display_name').notNull(),
  preferred_name: text('preferred_name'),
  language: text('language', { enum: ['en', 'ar'] }),
  roles: text('roles').array().notNull(),
  client_company_id: uuid('client_company_id'),
  hubspot_owner_id: text('hubspot_owner_id'),
  clickup_user_id: text('clickup_user_id'),
  email: text('email'),
  archived_at: timestamp('archived_at', { withTimezone: true, mode: 'string' })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('members_language_check', sql`${t.language} in ('en', 'ar')`),
  unique('members_workspace_id_id').on(t.workspace_id, t.id),
  check('members_roles_check', sql`${t.roles} <@ ARRAY['admin','account_manager','delivery_lead','contributor','client_reviewer']::text[]`),
  check('members_company_check', sql`(${t.client_company_id} is null) = (not ('client_reviewer' = any(${t.roles})))`),
  foreignKey({ columns: [t.workspace_id, t.user_id], foreignColumns: [users.workspace_id, users.id] }),
  foreignKey({ columns: [t.workspace_id, t.client_company_id], foreignColumns: [client_companies.workspace_id, client_companies.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const client_companies = pgTable('client_companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  hubspot_company_id: text('hubspot_company_id')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('client_companies_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const connections = pgTable('connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  provider: text('provider', { enum: ['hubspot', 'clickup', 'mail'] }).notNull(),
  status: text('status', { enum: ['connected', 'needs_reconnect', 'paused', 'revoked'] }).notNull(),
  account_label: text('account_label'),
  external_account_id: text('external_account_id'),
  scopes: text('scopes').array(),
  token_ciphertext: text('token_ciphertext'),
  refresh_ciphertext: text('refresh_ciphertext'),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
  last_ok_at: timestamp('last_ok_at', { withTimezone: true, mode: 'string' }),
  last_error_code: text('last_error_code'),
  webhook_secrets: jsonb('webhook_secrets').notNull().default({}),
  poll_cursor: text('poll_cursor'),
  won_stage_id: text('won_stage_id'),
  delivery_lead_id: uuid('delivery_lead_id'),
  allowed_actions: jsonb('allowed_actions')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('connections_workspace_provider').on(t.workspace_id, t.provider),
  foreignKey({ columns: [t.workspace_id,t.delivery_lead_id], foreignColumns: [members.workspace_id,members.id] }),
  check('connections_provider_check', sql`${t.provider} in ('hubspot', 'clickup', 'mail')`),
  check('connections_status_check', sql`${t.status} in ('connected', 'needs_reconnect', 'paused', 'revoked')`),
  unique('connections_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const deals = pgTable('deals', {
  contract_start_date: date('contract_start_date'),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  client_company_id: uuid('client_company_id').notNull(),
  hubspot_deal_id: text('hubspot_deal_id').notNull(),
  name: text('name').notNull(),
  stage: text('stage'),
  amount: numeric('amount'),
  currency: text('currency'),
  owner_member_id: uuid('owner_member_id'),
  close_date: date('close_date'),
  hs_modified_at: timestamp('hs_modified_at', { withTimezone: true, mode: 'string' }),
  snapshot: jsonb('snapshot'),
  snapshot_hash: text('snapshot_hash')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('deals_workspace_id_id').on(t.workspace_id, t.id),
  unique('deals_hubspot_deal_id_unique').on(t.workspace_id, t.hubspot_deal_id),
  foreignKey({ columns: [t.workspace_id, t.client_company_id], foreignColumns: [client_companies.workspace_id, client_companies.id] }),
  foreignKey({ columns: [t.workspace_id, t.owner_member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const line_items = pgTable('line_items', {
  cadence: text('cadence', { enum: ['once', 'monthly', 'weekly'] }),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  deal_id: uuid('deal_id').notNull(),
  hubspot_line_item_id: text('hubspot_line_item_id'),
  name: text('name'),
  sku: text('sku'),
  quantity: numeric('quantity'),
  price: numeric('price'),
  hs_modified_at: timestamp('hs_modified_at', { withTimezone: true, mode: 'string' }),
  snapshot_hash: text('snapshot_hash')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('line_items_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.deal_id], foreignColumns: [deals.workspace_id, deals.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const scope_documents = pgTable('scope_documents', {
  pages: jsonb('pages'),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  deal_id: uuid('deal_id').notNull(),
  source: text('source', { enum: ['hubspot_note', 'upload'] }).notNull(),
  hubspot_file_id: text('hubspot_file_id'),
  filename: text('filename'),
  sha256: text('sha256'),
  page_count: integer('page_count'),
  text: text('text'),
  received_at: timestamp('received_at', { withTimezone: true, mode: 'string' })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('scope_documents_source_check', sql`${t.source} in ('hubspot_note', 'upload')`),
  unique('scope_documents_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.deal_id], foreignColumns: [deals.workspace_id, deals.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const scope_versions = pgTable('scope_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  deal_id: uuid('deal_id').notNull(),
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'accepted', 'superseded'] }).notNull(),
  source_document_id: uuid('source_document_id'),
  items_hash: text('items_hash'),
  reason: text('reason'),
  created_by: uuid('created_by'),
  accepted_by: uuid('accepted_by'),
  accepted_at: timestamp('accepted_at', { withTimezone: true, mode: 'string' })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('scope_versions_status_check', sql`${t.status} in ('draft', 'accepted', 'superseded')`),
  unique('scope_versions_workspace_id_id').on(t.workspace_id, t.id),
  unique('scope_versions_version_unique').on(t.workspace_id, t.deal_id, t.version),
  foreignKey({ columns: [t.workspace_id, t.deal_id], foreignColumns: [deals.workspace_id, deals.id] }),
  foreignKey({ columns: [t.workspace_id, t.source_document_id], foreignColumns: [scope_documents.workspace_id, scope_documents.id] }),
  foreignKey({ columns: [t.workspace_id, t.created_by], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id, t.accepted_by], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const scope_items = pgTable('scope_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  scope_version_id: uuid('scope_version_id').notNull(),
  key: text('key'),
  title: text('title'),
  quantity: numeric('quantity'),
  cadence: text('cadence', { enum: ['once', 'monthly', 'weekly'] }),
  due_rule: text('due_rule'),
  source_page: integer('source_page'),
  source_quote: text('source_quote'),
  method: text('method', { enum: ['parser', 'ai'] }),
  confidence: numeric('confidence')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('scope_items_cadence_check', sql`${t.cadence} in ('once', 'monthly', 'weekly')`),
  check('scope_items_method_check', sql`${t.method} in ('parser', 'ai')`),
  unique('scope_items_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.scope_version_id], foreignColumns: [scope_versions.workspace_id, scope_versions.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const deliverable_mappings = pgTable('deliverable_mappings', {
  synonyms: jsonb('synonyms').notNull().default([]),
  due_offset_days: integer('due_offset_days').notNull().default(0),
  clickup_list_id: text('clickup_list_id'),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  match_sku: text('match_sku'),
  match_title_normalised: text('match_title_normalised'),
  template_list: text('template_list'),
  task_title: text('task_title'),
  default_role: text('default_role'),
  estimate_minutes: integer('estimate_minutes'),
  status: text('status', { enum: ['active', 'waiting_approval'] }),
  learned_from_run_id: uuid('learned_from_run_id')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('deliverable_mappings_status_check', sql`${t.status} in ('active', 'waiting_approval')`),
  unique('deliverable_mappings_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.learned_from_run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const memories = pgTable('memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  scope: text('scope', { enum: ['person', 'org'] }).notNull(),
  member_id: uuid('member_id'),
  kind: text('kind', { enum: ['preference', 'client_preference', 'decision', 'mapping'] }),
  text: text('text'),
  based_on: jsonb('based_on'),
  based_on_count: integer('based_on_count'),
  status: text('status', { enum: ['active', 'waiting_approval'] })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('memories_scope_check', sql`${t.scope} in ('person', 'org')`),
  check('memories_kind_check', sql`${t.kind} in ('preference', 'client_preference', 'decision', 'mapping')`),
  check('memories_status_check', sql`${t.status} in ('active', 'waiting_approval')`),
  unique('memories_workspace_id_id').on(t.workspace_id, t.id),
  check('memories_owner_check', sql`${t.scope} <> 'person' or ${t.member_id} is not null`),
  foreignKey({ columns: [t.workspace_id, t.member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const runs = pgTable('runs', {
  delivery_lead_id: uuid('delivery_lead_id'),
  plus_address: text('plus_address'),
  mail_thread_ids: text('mail_thread_ids').array().notNull().default(sql`'{}'::text[]`),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  deal_id: uuid('deal_id').notNull(),
  run_key: text('run_key').notNull(),
  status: text('status', { enum: ['received', 'analysing', 'blocked', 'waiting_approval', 'executing', 'partly_done', 'ready', 'in_delivery', 'paused', 'cancelled'] }).notNull(),
  trigger_event_id: uuid('trigger_event_id'),
  scope_version_id: uuid('scope_version_id'),
  plan: jsonb('plan'),
  plan_hash: text('plan_hash'),
  won_at: timestamp('won_at', { withTimezone: true, mode: 'string' }),
  ready_at: timestamp('ready_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('runs_status_check', sql`${t.status} in ('received', 'analysing', 'blocked', 'waiting_approval', 'executing', 'partly_done', 'ready', 'in_delivery', 'paused', 'cancelled')`),
  unique('runs_workspace_id_id').on(t.workspace_id, t.id),
  unique('runs_run_key_unique').on(t.workspace_id, t.run_key),
  foreignKey({ columns: [t.workspace_id,t.delivery_lead_id], foreignColumns: [members.workspace_id,members.id] }),
  foreignKey({ columns: [t.workspace_id, t.deal_id], foreignColumns: [deals.workspace_id, deals.id] }),
  foreignKey({ columns: [t.workspace_id, t.trigger_event_id], foreignColumns: [inbound_events.workspace_id, inbound_events.id] }),
  foreignKey({ columns: [t.workspace_id, t.scope_version_id], foreignColumns: [scope_versions.workspace_id, scope_versions.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const onboarding_inputs = pgTable('onboarding_inputs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  run_id: uuid('run_id').notNull(),
  key: text('key'),
  label: text('label'),
  status: text('status', { enum: ['missing', 'received', 'rejected'] }),
  requested_at: timestamp('requested_at', { withTimezone: true, mode: 'string' }),
  received_at: timestamp('received_at', { withTimezone: true, mode: 'string' }),
  source_message_id: uuid('source_message_id'),
  evidence: jsonb('evidence')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('onboarding_inputs_status_check', sql`${t.status} in ('missing', 'received', 'rejected')`),
  unique('onboarding_inputs_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id, t.source_message_id], foreignColumns: [agent_messages.workspace_id, agent_messages.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const findings = pgTable('findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  run_id: uuid('run_id').notNull(),
  kind: text('kind', { enum: ['scope_mismatch', 'missing_input', 'contradiction', 'overdue_client_approval', 'deadline_risk', 'scope_change_request', 'no_owner', 'unusual_instruction'] }).notNull(),
  severity: text('severity', { enum: ['block', 'warn', 'info'] }),
  title: text('title'),
  evidence: jsonb('evidence'),
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] }),
  owner_member_id: uuid('owner_member_id'),
  resolution: text('resolution'),
  resolved_by: uuid('resolved_by'),
  resolved_at: timestamp('resolved_at', { withTimezone: true, mode: 'string' })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('findings_kind_check', sql`${t.kind} in ('scope_mismatch', 'missing_input', 'contradiction', 'overdue_client_approval', 'deadline_risk', 'scope_change_request', 'no_owner', 'unusual_instruction')`),
  check('findings_severity_check', sql`${t.severity} in ('block', 'warn', 'info')`),
  check('findings_status_check', sql`${t.status} in ('open', 'resolved', 'dismissed')`),
  unique('findings_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id, t.owner_member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id, t.resolved_by], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const approvals = pgTable('approvals', {
  decisions: jsonb('decisions').notNull().default([]),
  confirmed_by: uuid('confirmed_by'),
  confirmed_at: timestamp('confirmed_at', { withTimezone: true, mode: 'string' }),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  run_id: uuid('run_id').notNull(),
  kind: text('kind', { enum: ['plan_correction', 'provision', 'client_email', 'scope_change', 'reversal'] }).notNull(),
  requested_by_type: text('requested_by_type', { enum: ['user', 'agent'] }),
  requested_by_member_id: uuid('requested_by_member_id'),
  required_roles: text('required_roles').array(),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'expired', 'stale', 'executing', 'executed', 'cancelled'] }),
  payload: jsonb('payload'),
  payload_hash: text('payload_hash'),
  input_refs: jsonb('input_refs'),
  input_hash: text('input_hash'),
  reversibility: text('reversibility', { enum: ['reversible', 'cancellable', 'irreversible'] }),
  expires_at: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
  decided_by: uuid('decided_by'),
  decided_at: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
  decision_note: text('decision_note'),
  executed_at: timestamp('executed_at', { withTimezone: true, mode: 'string' }),
  execution_summary: jsonb('execution_summary'),
  stale_reason: text('stale_reason')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  foreignKey({ columns: [t.workspace_id, t.confirmed_by], foreignColumns: [members.workspace_id, members.id] }),
  check('approvals_kind_check', sql`${t.kind} in ('plan_correction', 'provision', 'client_email', 'scope_change', 'reversal')`),
  check('approvals_requested_by_type_check', sql`${t.requested_by_type} in ('user', 'agent')`),
  check('approvals_status_check', sql`${t.status} in ('pending', 'approved', 'rejected', 'expired', 'stale', 'executing', 'executed', 'cancelled')`),
  check('approvals_reversibility_check', sql`${t.reversibility} in ('reversible', 'cancellable', 'irreversible')`),
  unique('approvals_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id, t.requested_by_member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id, t.decided_by], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const external_effects = pgTable('external_effects', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  run_id: uuid('run_id').notNull(),
  approval_id: uuid('approval_id'),
  effect_key: text('effect_key').notNull(),
  system: text('system'),
  action: text('action'),
  target_ref: text('target_ref'),
  request: jsonb('request'),
  request_hash: text('request_hash'),
  state: text('state', { enum: ['planned', 'in_flight', 'succeeded', 'failed', 'unknown', 'compensated', 'cancelled'] }),
  external_id: text('external_id'),
  attempts: integer('attempts'),
  last_error_code: text('last_error_code'),
  reversibility: text('reversibility', { enum: ['reversible', 'cancellable', 'irreversible'] }),
  parent_effect_id: uuid('parent_effect_id'),
  result: jsonb('result'),
  compensates_effect_id: uuid('compensates_effect_id')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('external_effects_state_check', sql`${t.state} in ('planned', 'in_flight', 'succeeded', 'failed', 'unknown', 'compensated', 'cancelled')`),
  check('external_effects_reversibility_check', sql`${t.reversibility} in ('reversible', 'cancellable', 'irreversible')`),
  unique('external_effects_workspace_id_id').on(t.workspace_id, t.id),
  unique('external_effects_effect_key_unique').on(t.workspace_id, t.effect_key),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id, t.approval_id], foreignColumns: [approvals.workspace_id, approvals.id] }),
  foreignKey({ columns: [t.workspace_id, t.compensates_effect_id], foreignColumns: [external_effects.workspace_id, external_effects.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const inbound_events = pgTable('inbound_events', {
  run_id: uuid('run_id'),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  source: text('source', { enum: ['hubspot', 'clickup', 'mail', 'replay'] }).notNull(),
  dedupe_key: text('dedupe_key').notNull(),
  event_type: text('event_type'),
  external_object_id: text('external_object_id'),
  raw: jsonb('raw'),
  signature_ok: boolean('signature_ok'),
  received_via: text('received_via', { enum: ['webhook', 'reconcile', 'poll', 'replay'] }),
  received_at: timestamp('received_at', { withTimezone: true, mode: 'string' }),
  processed_at: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
  result: text('result')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('inbound_events_source_check', sql`${t.source} in ('hubspot', 'clickup', 'mail', 'replay')`),
  check('inbound_events_received_via_check', sql`${t.received_via} in ('webhook', 'reconcile', 'poll', 'replay')`),
  unique('inbound_events_workspace_id_id').on(t.workspace_id, t.id),
  unique('inbound_events_dedupe_key_unique').on(t.workspace_id, t.dedupe_key),
  foreignKey({ columns: [t.workspace_id,t.run_id], foreignColumns: [runs.workspace_id,runs.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const jobs = pgTable('jobs', {
  lock_token: uuid('lock_token'),
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  kind: text('kind'),
  payload: jsonb('payload'),
  run_id: uuid('run_id'),
  dedupe_key: text('dedupe_key'),
  status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'dead', 'cancelled'] }),
  attempts: integer('attempts'),
  max_attempts: integer('max_attempts').default(5),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }),
  locked_until: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
  last_error_code: text('last_error_code')
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('jobs_status_check', sql`${t.status} in ('queued', 'running', 'done', 'failed', 'dead', 'cancelled')`),
  unique('jobs_workspace_id_id').on(t.workspace_id, t.id),
  unique('jobs_dedupe_key_unique').on(t.workspace_id, t.dedupe_key),
  index('jobs_ready').on(t.next_attempt_at).where(sql`${t.status} in ('queued','running','failed')`),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const recovery_items = pgTable('recovery_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  run_id: uuid('run_id'),
  job_id: uuid('job_id'),
  effect_id: uuid('effect_id'),
  finding_id: uuid('finding_id'),
  kind: text('kind'),
  title: text('title'),
  plain_reason: text('plain_reason'),
  owner_member_id: uuid('owner_member_id'),
  status: text('status', { enum: ['open', 'retrying', 'resolved', 'cancelled'] }),
  allowed_options: text('allowed_options').array(),
  resolved_by: uuid('resolved_by'),
  resolution_note: text('resolution_note'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('recovery_items_status_check', sql`${t.status} in ('open', 'retrying', 'resolved', 'cancelled')`),
  unique('recovery_items_workspace_id_id').on(t.workspace_id, t.id),
  uniqueIndex('recovery_one_per_job').on(t.workspace_id,t.job_id).where(sql`${t.job_id} is not null`),
  foreignKey({ columns: [t.workspace_id, t.run_id], foreignColumns: [runs.workspace_id, runs.id] }),
  foreignKey({ columns: [t.workspace_id, t.job_id], foreignColumns: [jobs.workspace_id, jobs.id] }),
  foreignKey({ columns: [t.workspace_id, t.effect_id], foreignColumns: [external_effects.workspace_id, external_effects.id] }),
  foreignKey({ columns: [t.workspace_id, t.finding_id], foreignColumns: [findings.workspace_id, findings.id] }),
  foreignKey({ columns: [t.workspace_id, t.owner_member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id, t.resolved_by], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const audit_log = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  at: timestamp('at', { withTimezone: true, mode: 'string' }).defaultNow(),
  actor_type: text('actor_type', { enum: ['user', 'agent', 'webhook', 'schedule', 'system'] }).notNull(),
  actor_member_id: uuid('actor_member_id'),
  actor_name_at_event: text('actor_name_at_event'),
  actor_roles_at_event: text('actor_roles_at_event').array(),
  action: text('action').notNull(),
  outcome: text('outcome', { enum: ['allowed', 'denied', 'succeeded', 'failed'] }).notNull(),
  target_type: text('target_type'),
  target_id: text('target_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  approval_id: uuid('approval_id'),
  effect_id: uuid('effect_id'),
  request_id: text('request_id'),
  prev_hash: text('prev_hash'),
  row_hash: text('row_hash').notNull()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('audit_log_actor_type_check', sql`${t.actor_type} in ('user', 'agent', 'webhook', 'schedule', 'system')`),
  check('audit_log_outcome_check', sql`${t.outcome} in ('allowed', 'denied', 'succeeded', 'failed')`),
  unique('audit_log_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.actor_member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id, t.approval_id], foreignColumns: [approvals.workspace_id, approvals.id] }),
  foreignKey({ columns: [t.workspace_id, t.effect_id], foreignColumns: [external_effects.workspace_id, external_effects.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const agent_threads = pgTable('agent_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  member_id: uuid('member_id').notNull(),
  title: text('title'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('agent_threads_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const agent_messages = pgTable('agent_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  thread_id: uuid('thread_id').notNull(),
  member_id: uuid('member_id').notNull(),
  role: text('role', { enum: ['user', 'agent', 'system'] }).notNull(),
  body: text('body'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow()
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  check('agent_messages_role_check', sql`${t.role} in ('user', 'agent', 'system')`),
  unique('agent_messages_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.thread_id], foreignColumns: [agent_threads.workspace_id, agent_threads.id] }),
  foreignKey({ columns: [t.workspace_id, t.member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspace_id: uuid('workspace_id').notNull(),
  member_id: uuid('member_id').notNull(),
  kind: text('kind'),
  body: text('body'),
  link: text('link'),
  read_at: timestamp('read_at', { withTimezone: true, mode: 'string' })
}, (t): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  unique('notifications_workspace_id_id').on(t.workspace_id, t.id),
  foreignKey({ columns: [t.workspace_id, t.member_id], foreignColumns: [members.workspace_id, members.id] }),
  foreignKey({ columns: [t.workspace_id], foreignColumns: [workspaces.id] })
]);


export const demo_faults = pgTable('demo_faults', {
  workspace_id: uuid('workspace_id').notNull().references(() => workspaces.id),
  provider: text('provider', { enum: ['hubspot', 'clickup', 'mail'] }).notNull(),
  fail_next: integer('fail_next').notNull().default(0),
  mode: text('mode', { enum: ['outage', 'revoked'] }).notNull(),
}, t => [
  primaryKey({ columns: [t.workspace_id, t.provider] }),
  check('demo_faults_provider_check', sql`${t.provider} in ('hubspot','clickup','mail')`),
  check('demo_faults_count_check', sql`${t.fail_next} >= 0`),
  check('demo_faults_mode_check', sql`${t.mode} in ('outage','revoked')`),
]);
export const rate_buckets = pgTable('rate_buckets', {
  workspace_id: uuid('workspace_id').notNull().references(() => workspaces.id),
  provider: text('provider', { enum: ['hubspot', 'clickup'] }).notNull(),
  bucket_key: text('bucket_key').notNull(),
  tokens: numeric('tokens').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}, t => [
  primaryKey({ columns: [t.provider, t.bucket_key] }),
  check('rate_buckets_provider_check', sql`${t.provider} in ('hubspot','clickup')`),
  check('rate_buckets_tokens_check', sql`${t.tokens} >= 0 and ${t.tokens} <= 100`),
]);
