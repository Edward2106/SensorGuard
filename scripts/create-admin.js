// Password is read from stdin; never put it in argv, logs, or a checked-in file.
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { initializeAuth, authStore } from '../src/security/store.js';
import { hashPassword } from '../src/security/password.js';
const username = process.argv[2];
if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username || '')) throw new Error('Usage: password via stdin | node scripts/create-admin.js username');
try {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1024) throw new Error('Input too long'); }
  const passwordHash = await hashPassword(input.replace(/[\r\n]+$/, ''));
  input = '';
  await connectMongo(); await initializeAuth();
  if (await authStore.findUser(username)) throw new Error('Account exists; refusing to overwrite');
  await authStore.createUser({ username, passwordHash, role: 'ADMIN' });
  console.log('Administrator created. No existing accounts changed.');
} catch (error) { console.error(error.code === 11000 ? 'Account exists' : error.message); process.exitCode = 1; }
finally { await disconnectMongo(); }
