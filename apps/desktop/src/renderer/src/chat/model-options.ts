import type { ProviderProfile } from '../../../shared/providers';
export const usableModel=(p:ProviderProfile)=>p.enabled&&p.hasKey&&p.connection?.outcome==='passed'&&p.connection.revision===p.revision;
