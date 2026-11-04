import type { Language } from '../lib/i18n';
import { loadMessages } from '../lib/i18n';
export function LanguageLink({ locale, path, menu = false }: { locale: Language; path: string; menu?: boolean }) {
  return <a className={menu ? 'menu-row' : 'language-link'} role={menu ? 'menuitem' : undefined} href={`${path}?lang=${locale === 'ar' ? 'en' : 'ar'}`} lang={locale === 'ar' ? 'en' : 'ar'}>{loadMessages(locale).common.language}</a>;
}
