import { z } from 'zod';
const identifier = z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String);
export const hubspotEvent = z.object({ portalId: identifier, eventId: identifier, objectId: identifier, subscriptionType: z.string(), propertyName: z.string().optional(), propertyValue: z.string().optional(), occurredAt: z.number().optional() }).passthrough();
export type HubspotEvent = z.infer<typeof hubspotEvent>;
export const clickupEvent = z.object({ webhook_id: z.string().min(1), event: z.string(), task_id: z.string().optional(), history_items: z.array(z.object({ id: identifier }).passthrough()).min(1) });
export type ReceivedVia = 'webhook' | 'reconcile' | 'replay';
