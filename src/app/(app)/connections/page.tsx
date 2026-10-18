import { ConnectionsScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page() {return <ConnectionsScreen locale={await getLanguage()} />;}
