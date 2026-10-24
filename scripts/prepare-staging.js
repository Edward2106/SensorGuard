import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const names=['MONGO_ROOT_PASSWORD','MONGO_APP_PASSWORD','REDIS_PASSWORD','DEVICE_API_KEY'];
writeFileSync('.env.staging.local', names.map(name=>`${name}=${randomBytes(32).toString('base64url')}`).join('\n')+'\n', { flag:'wx', mode:0o600 });
console.log('Created .env.staging.local with independent random credentials. Never commit this file.');
