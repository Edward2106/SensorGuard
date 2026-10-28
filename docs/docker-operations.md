# Docker operations — SensorGuard

## Ownership and inventory

`node scripts/docker-inventory.js scratch/inventory-UNIQUE.json` is read-only and refuses to overwrite evidence. It records container IDs, Compose projects, images, status, CPU/memory sample, ports, mounts, networks and lifecycle timestamps. It never stores environment variables. A low CPU value or an old name does not establish inactivity.

Main staging is the five services in project `sensorguard-phase8-staging`. Other projects, RedisInsight, development Redis and data volumes are outside cleanup by default. Stop QA only after its test process has finished and queue/dependency checks show no active work. Use individual inspected IDs, never a name wildcard. Keep containers, images, volumes, networks, backups and evidence. Snapshot CPU/RAM samples are not a controlled savings benchmark.

## Existing staging and rollback image

Keep its existing `.env.staging` and project name. Never regenerate credentials for an existing volume. The original preview image `sensorguard-intelligence:preview-local` remains a rollback image. Build hardening separately:

```powershell
docker build -f deploy/Dockerfile -t sensorguard-hardening:local .
docker compose --env-file .env.staging -f deploy/compose.yml -f deploy/compose.preview.yml config --quiet
```

The preview overlay intentionally still selects the preview image. Applying a new image or recreating staging services requires the owner's maintenance-window approval; a build does not deploy it.

The approved hardening release now uses all three files below. Keep them together on subsequent starts; dropping the TLS overlay would point at the old unused storage volume. Validate before any maintenance operation:

```powershell
docker compose --env-file .env.staging -p sensorguard-phase8-staging -f deploy/compose.yml -f deploy/compose.hardening.yml -f deploy/compose.tls-persistent.yml config --quiet
docker compose --env-file .env.staging -p sensorguard-phase8-staging -f deploy/compose.yml -f deploy/compose.hardening.yml -f deploy/compose.tls-persistent.yml ps
```

The migration was verified29/10/2026: original CA checksum preserved, HTTPS validation enabled, original MongoDB/Redis containers and volumes unchanged,11sensors/59readings/16incidents/59events retained. No new staging demo was run. Temporary QA accounts were disabled again after approved read-only verification. The maintenance-window timestamps are evidence of an operation window, not a continuously measured outage duration.

## TLS storage and original CA

The audited proxy stores its original CA under `/root/.local/share/caddy`, while `/data` and `/config` are mounted. Do not recreate it with an empty storage directory. Back up the complete original Caddy storage and Caddyfile into an ignored, access-restricted local directory. Keep private keys out of Git, logs and reports. Record certificate checksums and retain the original trusted certificate.

The following scripts require the verified backup metadata created during the audit:

```powershell
node scripts/verify-tls-persistence.js scratch/hardening-caddy-backup.json
node scripts/prepare-tls-storage.js scratch/hardening-caddy-backup.json
```

The first tests two isolated QA containers sharing new `/data` and `/config` volumes, checking HTTPS with the original CA and TLS verification enabled. It stops its own containers and retains everything. The second refuses to overwrite an existing target volume and prepares `sensorguard-phase8-staging_caddy_persistent_data`; it does not deploy staging.

`deploy/compose.tls-persistent.yml` sets `XDG_DATA_HOME=/data` and `XDG_CONFIG_HOME=/config`, and mounts the prepared volume at `/data`. Only apply it after comparing the original root certificate hash and obtaining specific proxy-recreation approval. The CA copy must precede the first start. Preserve the existing `/config` volume and original `/data` volume.

Rollback plan: preserve the backup and original image/config. If rollback is needed, create the proxy with its original configuration without starting it, copy the backed-up `caddy` directory to `/root/.local/share/`, then start it and verify against the original CA. Never accept newly generated trust as a successful rollback. Rollback itself is a maintenance operation requiring approval; restoring CA storage does not involve MongoDB or Redis data.

## QA lifecycle

The dedicated MongoDB QA uses localhost27029 and a guarded scratch dbPath. The external QA network and Redis are separate from staging. The env file is private and must name `sg_intelligence_qa_*`, the QA Mongo host and QA Redis host.

```powershell
docker start sensorguard-phase9-mongo7-qa
docker start sensorguard-intelligence-redis-qa
$env:SENSORGUARD_QA_ENV_FILE=(Resolve-Path scratch/intelligence-qa.env).Path
docker compose -f deploy/compose.qa.yml config --quiet
docker compose -f deploy/compose.qa.yml up -d --wait
docker exec sensorguard-hardening-api-qa node scripts/verify-intelligence.js
node scripts/verify-reliability.js
```

Do not run fault injection while other tests use the same QA database/Redis. After test completion, check active/waiting/delayed queue jobs and unresolved workflows. Retained terminal failed jobs are evidence, not a reason to reset Redis. Stop exact QA app IDs with graceful worker drain, then exact QA Redis/Mongo IDs if there are no other consumers. Starting those same containers later preserves their data.

## Local Datadog boundaries

`node scripts/check-observability.js` validates JSON structure and references to implemented custom metric names offline. It is not Cloud schema validation. Keep all emission off unless approved: global metrics flag plus separate recovery/workflow opt-ins; global gauges require one designated owner. The heartbeat counter measures successful Redis heartbeat writes, not the number of distinct healthy workers.

Windows Agent service presence does not prove logs/traces reached Cloud. If local `agent status` cannot read its protected config/token, report unavailable and ask the administrator to run it with appropriate OS rights. Do not weaken ACLs, replace credentials or enable paid features to obtain a green status.
