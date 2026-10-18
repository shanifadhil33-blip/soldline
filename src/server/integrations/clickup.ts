import 'server-only';
import { z } from 'zod';
import { Transport, type TransportOptions, entity, emptyResponse, segment } from './transport';
export const CLICKUP_PATHS = { team: '/api/v2/team', space: '/api/v2/space', folder: '/api/v2/folder', list: '/api/v2/list', task: '/api/v2/task' } as const;
export interface TaskInput {
  name: string; markdown_content?: string; assignees?: number[]; due_date?: number; due_date_time?: boolean;
  time_estimate?: number; status?: string; tags?: string[];
}
export interface TaskUpdate { name?: string; assignees?: { add?: number[]; rem?: number[] }; due_date?: number | null; due_date_time?: boolean; time_estimate?: number; status?: string }
export interface WebhookInput { endpoint: string; events: string[]; space_id?: string; folder_id?: string }
const task = entity.extend({ markdown_description: z.string().optional(), status: z.object({ status: z.string() }).passthrough().optional() });
export class ClickUpClient {
  private readonly http: Transport;
  private readonly connections: TransportOptions['connections'];
  constructor(options: TransportOptions) { this.http = new Transport('clickup', 'https://api.clickup.com', options); this.connections = options.connections; }
  listSpaces(teamId: string) { return this.http.request('GET', `${CLICKUP_PATHS.team}/${segment(teamId)}/space`, z.object({ spaces: z.array(entity) })); }
  listFolders(spaceId: string) { return this.http.request('GET', `${CLICKUP_PATHS.space}/${segment(spaceId)}/folder`, z.object({ folders: z.array(entity) })); }
  listLists(folderId: string) { return this.http.request('GET', `${CLICKUP_PATHS.folder}/${segment(folderId)}/list`, z.object({ lists: z.array(entity) })); }
  createFolder(spaceId: string, name: string) { return this.http.request('POST', `${CLICKUP_PATHS.space}/${segment(spaceId)}/folder`, entity, { name }); }
  createList(folderId: string, name: string) { return this.http.request('POST', `${CLICKUP_PATHS.folder}/${segment(folderId)}/list`, entity, { name }); }
  createTask(listId: string, input: TaskInput) { return this.http.request('POST', `${CLICKUP_PATHS.list}/${segment(listId)}/task`, task, { ...input, due_date_time: false }); }
  getListTasks(listId: string, page = 0) { return this.http.request('GET', `${CLICKUP_PATHS.list}/${segment(listId)}/task?include_markdown_description=true&subtasks=true&page=${page}`, z.object({ tasks: z.array(task), last_page: z.boolean().optional() })); }
  getFolder(id: string) { return this.http.request('GET', `${CLICKUP_PATHS.folder}/${segment(id)}`, entity); }
  getList(id: string) { return this.http.request('GET', `${CLICKUP_PATHS.list}/${segment(id)}`, entity); }
  getTask(id: string) { return this.http.request('GET', `${CLICKUP_PATHS.task}/${segment(id)}`, task); }
  archiveList(id: string) { return this.http.request('PUT', `${CLICKUP_PATHS.list}/${segment(id)}`, entity, { archived: true }); }
  archiveFolder(id: string) { return this.http.request('PUT', `${CLICKUP_PATHS.folder}/${segment(id)}`, entity, { archived: true }); }
  updateTask(id: string, input: TaskUpdate) { return this.http.request('PUT', `${CLICKUP_PATHS.task}/${segment(id)}`, task, input); }
  archiveTask(id: string) { return this.http.request('PUT', `${CLICKUP_PATHS.task}/${segment(id)}`, task, { archived: true }); }
  deleteTask(id: string) { return this.http.request('DELETE', `${CLICKUP_PATHS.task}/${segment(id)}`, emptyResponse); }
  addComment(id: string, text: string) { return this.http.request('POST', `${CLICKUP_PATHS.task}/${segment(id)}/comment`, entity, { comment_text: text, notify_all: false }); }
  async createWebhook(teamId: string, input: WebhookInput) {
    const result = await this.http.request('POST', `${CLICKUP_PATHS.team}/${segment(teamId)}/webhook`, z.object({ id: z.string().optional(), webhook: z.object({ id: z.string().optional(), secret: z.string() }).passthrough() }), input);
    const id = result.id ?? result.webhook.id;
    if (!id) throw new Error('Provider response is incomplete');
    return { id, secret_ciphertext: await this.connections.saveWebhookSecret(id, result.webhook.secret) };
  }
  listMembers(teamId: string) { return this.http.request('GET', `${CLICKUP_PATHS.team}/${segment(teamId)}/member`, z.object({ members: z.array(z.object({ user: z.object({ id: z.number(), username: z.string().optional(), email: z.email().optional() }) })) })); }
}
