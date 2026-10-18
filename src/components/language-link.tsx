import type { Language } from '../lib/i18n';
import { loadMessages } from '../lib/i18n';
export function LanguageLink({ locale, path }: { locale: Language; path: string }) {
  return <a className="language-link" href={`${path}?lang=${locale === 'ar' ? 'en' : 'ar'}`} lang={locale === 'ar' ? 'en' : 'ar'}>{loadMessages(locale).common.language}</a>;
}
