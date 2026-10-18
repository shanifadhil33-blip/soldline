import { RecoveryScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page() {return <RecoveryScreen locale={await getLanguage()} />;}
