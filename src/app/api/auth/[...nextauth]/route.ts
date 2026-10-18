import { handlers } from '../../../../auth';
// Permission guard exception: Auth.js owns OAuth validation and database session writes through its adapter.
// Export directly. Rewrapping a NextRequest breaks its private state on OAuth callbacks.
export const { GET, POST } = handlers;
