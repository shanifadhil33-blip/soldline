import { staffOnly } from '../../../server/screens';
import { ConnectionsScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page() {
  await staffOnly(false);return <ConnectionsScreen locale={await getLanguage()} />;}
