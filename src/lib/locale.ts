import 'server-only';
import { headers } from 'next/headers';
import { language } from './i18n';
export async function getLanguage() { return language((await headers()).get('x-soldline-language') ?? undefined); }
