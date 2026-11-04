import { staffOnly } from '../../../server/screens';
import { RecoveryScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page() {
  await staffOnly();return <RecoveryScreen locale={await getLanguage()} />;}
