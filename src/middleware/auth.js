import { security } from '../security/auth.js';
// Keep existing resource routers and device clients compatible.
export const authenticateApiKey = security.authenticate;
export default authenticateApiKey;
