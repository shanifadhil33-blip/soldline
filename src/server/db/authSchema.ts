import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';
/** Auth.js camel case properties map to the existing P2 SQL names. No tables are renamed. */
export function authTables(workspaceId: string) {
  const workspace = () => uuid('workspace_id').notNull().$defaultFn(() => workspaceId);
  return {
    usersTable: pgTable('users', {
      id: uuid('id').defaultRandom().primaryKey(), workspace_id: workspace(), name: text('name'), email: text('email').notNull(),
      emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }), image: text('image'),
    }),
    accountsTable: pgTable('accounts', {
      workspace_id: workspace(), userId: uuid('user_id').notNull(), type: text('type').$type<AdapterAccountType>().notNull(), provider: text('provider').notNull(), providerAccountId: text('provider_account_id').notNull(),
      refresh_token: text('refresh_token'), access_token: text('access_token'), expires_at: integer('expires_at'), token_type: text('token_type'), scope: text('scope'), id_token: text('id_token'), session_state: text('session_state'),
    }),
    sessionsTable: pgTable('sessions', {
      workspace_id: workspace(), sessionToken: text('session_token').primaryKey(), userId: uuid('user_id').notNull(), expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
    }),
    verificationTokensTable: pgTable('verification_tokens', {
      workspace_id: workspace(), identifier: text('identifier').notNull(), token: text('token').notNull(), expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
    }),
  };
}
