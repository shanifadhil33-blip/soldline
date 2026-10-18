import 'server-only';
import { getOwnerServices } from '../db/runtime';
import { work } from './worker';
export function runWorker() { const {jobs,providers}=getOwnerServices(); return work(jobs,providers); }
