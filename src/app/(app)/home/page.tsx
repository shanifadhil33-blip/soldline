import { ClientScreen } from '../../../components/trust-screens';
import { getLanguage } from '../../../lib/locale';
export default async function Page() {return <ClientScreen locale={await getLanguage()} />;}
