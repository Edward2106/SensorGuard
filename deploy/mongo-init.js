// Executed only when initializing a NEW staging MongoDB volume.
const target = db.getSiblingDB('sensorguard_staging');
target.createUser({ user: 'sensorguard', pwd: process.env.MONGO_APP_PASSWORD, roles: [{ role: 'readWrite', db: 'sensorguard_staging' }] });
