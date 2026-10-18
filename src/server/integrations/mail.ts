import 'server-only';
import { z } from 'zod';
import { Transport, type TransportOptions, segment } from './transport';
// UNVERIFIED. Confirm all paths against the live inbox API before P8.
export const MAIL_PATHS = {
  inbox: (inbox: string) => `/inboxes/${segment(inbox)}`,
  messages: (inbox: string) => `/inboxes/${segment(inbox)}/messages`,
  message: (inbox: string, id: string) => `/inboxes/${segment(inbox)}/messages/${segment(id)}`,
  thread: (inbox: string, id: string) => `/inboxes/${segment(inbox)}/threads/${segment(id)}`,
  drafts: (inbox: string) => `/inboxes/${segment(inbox)}/drafts`,
  send: (inbox: string, id: string) => `/inboxes/${segment(inbox)}/drafts/${segment(id)}/send`,
} as const;
const message = z.object({ message_id: z.string(), thread_id: z.string().optional(), to: z.array(z.string()).optional(), subject: z.string().optional(), text: z.string().optional(), timestamp: z.string().optional() }).passthrough();
const messages = z.object({ messages: z.array(message), next_page_token: z.string().optional() });
const inbox = z.object({ inbox_id: z.string(), display_name: z.string().optional() }).passthrough();
const thread = z.object({ thread_id: z.string(), messages: z.array(message) }).passthrough();
const draft = z.object({ draft_id: z.string() }).passthrough();
export type MailMessage = z.infer<typeof message>;
export interface DraftInput { to: string[]; subject: string; text: string; replyToMessageId?: string; messageId?: string }
export interface SentSearch { to: string; subject: string; since: string; messageId?: string }
export interface MailProvider {
  getInbox(): Promise<z.infer<typeof inbox>>;
  listMessagesSince(cursor: string): Promise<z.infer<typeof messages>>;
  getMessage(id: string): Promise<MailMessage>;
  getThread(id: string): Promise<z.infer<typeof thread>>;
  createDraft(input: DraftInput): Promise<z.infer<typeof draft>>;
  sendDraft(draftId: string): Promise<MailMessage>;
  searchSent(input: SentSearch): Promise<z.infer<typeof messages>>;
}
export class AgentMailProvider implements MailProvider {
  private readonly http: Transport;
  private readonly address: string;
  constructor(options: TransportOptions & { base?: string; inbox?: string }) {
    this.address = options.inbox ?? process.env.MAIL_INBOX_ADDRESS ?? '';
    if (!this.address) throw new Error('Team inbox address is required');
    this.http = new Transport('mail', (options.base ?? process.env.MAIL_API_BASE ?? 'https://api.agentmail.to/v0').replace(/\/$/, ''), options);
  }
  getInbox() { return this.http.request('GET', MAIL_PATHS.inbox(this.address), inbox); }
  listMessagesSince(cursor: string) { return this.http.request('GET', MAIL_PATHS.messages(this.address) + '?' + new URLSearchParams({ after: cursor }), messages); }
  getMessage(id: string) { return this.http.request('GET', MAIL_PATHS.message(this.address, id), message); }
  getThread(id: string) { return this.http.request('GET', MAIL_PATHS.thread(this.address, id), thread); }
  createDraft(input: DraftInput) {
    return this.http.request('POST', MAIL_PATHS.drafts(this.address), draft, { to: input.to, subject: input.subject, text: input.text, ...(input.messageId ? { headers: { 'Message-ID': input.messageId } } : {}), ...(input.replyToMessageId ? { in_reply_to: input.replyToMessageId } : {}) });
  }
  sendDraft(id: string) { return this.http.request('POST', MAIL_PATHS.send(this.address, id), message, {}); }
  searchSent(input: SentSearch) { return this.http.request('GET', MAIL_PATHS.messages(this.address) + '?' + new URLSearchParams({ labels: 'sent', to: input.to, subject: input.subject, after: input.since, ...(input.messageId ? { message_id: input.messageId } : {}) }), messages); }
}

/** Explicit admin setup. Request methods subsequently load the encrypted credential. */
export async function configureMailFromEnv(connections: TransportOptions['connections'], env: Record<string, string | undefined> = process.env) {
  if (!env.MAIL_API_KEY || !env.MAIL_INBOX_ADDRESS) throw new Error('Mail key and inbox address are required');
  await connections.storeToken('mail', env.MAIL_API_KEY, env.MAIL_INBOX_ADDRESS);
  return new AgentMailProvider({ connections, inbox: env.MAIL_INBOX_ADDRESS, base: env.MAIL_API_BASE });
}
