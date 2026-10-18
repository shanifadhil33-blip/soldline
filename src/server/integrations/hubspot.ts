import 'server-only';
import { z } from 'zod';
import { Transport, type TransportOptions, segment } from './transport';
// Unknown paths require explicit confirmation. Never silently fall back to another API version.
export const HUBSPOT_PATHS = {
  deals: '/crm/objects/2026-03/deals', search: '/crm/objects/2026-03/deals/search',
  lineItems: '/crm/objects/2026-03/line_items/batch/read',
  notes: undefined, owners: undefined, fileSignedUrl: undefined,
} as const;
export interface HubSpotPaths { notes?: string; owners?: string; fileSignedUrl?: (id: string) => string }
export const crmObject = z.object({ id: z.string(), properties: z.record(z.string(), z.string().nullable()), associations: z.record(z.string(), z.object({ results: z.array(z.object({ id: z.string(), type: z.string().optional() })) })).optional() });
export const crmPage = z.object({ results: z.array(crmObject), paging: z.object({ next: z.object({ after: z.string() }) }).optional() });
export type CrmObject = z.infer<typeof crmObject>;
export interface DealWrite { soldline_delivery_status?: string; soldline_plan_url?: string; soldline_run_ref?: string }
export interface ApprovedDeal { modifiedAt: string; properties: Partial<Record<keyof DealWrite, string | null>> }
const dealProperties = 'dealname,dealstage,amount,closedate,hubspot_owner_id,hs_lastmodifieddate,soldline_delivery_status,soldline_plan_url,soldline_run_ref';
export class HubSpotClient {
  private readonly http: Transport;
  constructor(options: TransportOptions, private readonly paths: HubSpotPaths = {}) { this.http = new Transport('hubspot', 'https://api.hubapi.com', options); }
  getDeal(id: string) { return this.http.request('GET', `${HUBSPOT_PATHS.deals}/${segment(id)}?properties=${dealProperties}&associations=line_items,companies,contacts,notes`, crmObject); }
  searchDealsModifiedSince(cursor: string, after?: string) {
    return this.http.request('POST', HUBSPOT_PATHS.search, crmPage, { filterGroups: [{ filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: cursor }] }], properties: dealProperties.split(','), limit: 100, ...(after ? { after } : {}) });
  }
  batchReadLineItems(ids: string[]) {
    return this.http.request('POST', HUBSPOT_PATHS.lineItems, crmPage, { properties: ['name', 'quantity', 'price', 'hs_product_id', 'hs_sku', 'description', 'hs_lastmodifieddate'], inputs: ids.map(id => ({ id })) });
  }
  async listDealNotes(dealId: string) {
    const path = this.verified(this.paths.notes);
    const deal = await this.getDeal(dealId);
    const ids = deal.associations?.notes?.results.map(n => ({ id: n.id })) ?? [];
    if (!ids.length) return { results: [] };
    return this.http.request('POST', path, crmPage, { properties: ['hs_note_body', 'hs_attachment_ids', 'hs_timestamp'], inputs: ids });
  }
  getFileSignedUrl(id: string) {
    return this.http.request('GET', this.verified(this.paths.fileSignedUrl?.(segment(id))), z.object({ url: z.url() }));
  }
  async patchDealProperties(id: string, properties: DealWrite, approved: ApprovedDeal) {
    const current = await this.getDeal(id);
    if (Object.keys(properties).some(key => !Object.hasOwn(approved.properties, key)) || current.properties.hs_lastmodifieddate !== approved.modifiedAt || Object.entries(approved.properties).some(([key, value]) => (current.properties[key] ?? null) !== value)) throw new Error('Deal changed since approval');
    const allowed = ['soldline_delivery_status', 'soldline_plan_url', 'soldline_run_ref'];
    if (Object.keys(properties).some(key => !allowed.includes(key))) throw new Error('Deal property refused');
    return this.http.request('PATCH', `${HUBSPOT_PATHS.deals}/${segment(id)}`, crmObject, { properties });
  }
  getOwners(after?: string) {
    const path = this.verified(this.paths.owners);
    return this.http.request('GET', path + (after ? `?after=${segment(after)}` : ''), z.object({ results: z.array(z.object({ id: z.string(), email: z.email().optional(), firstName: z.string().optional(), lastName: z.string().optional() })), paging: z.object({ next: z.object({ after: z.string() }) }).optional() }));
  }
  private verified(path: string | undefined): string {
    if (!path || !path.startsWith('/') || path.startsWith('//')) throw new Error('Provider path needs confirmation');
    return path;
  }
}
