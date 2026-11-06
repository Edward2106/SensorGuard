# SensorGuard v1.0 — hackathon operations and acceptance

This release is a local hackathon application, not a production/HA certification.
Datadog Cloud and whole-application HA are explicitly out of scope. Existing staging
is inspected read-only; merging or tagging does not deploy it.

## Backup and restore

With the isolated QA services running, PowerShell:

```powershell
node scripts/verify-release-backup.js
node scripts/verify-auth-backup-qa.js scratch/v1-backup-restore.json
node scripts/verify-tls-persistence.js scratch/v1-backup-restore.json scratch/v1-tls-restore.json
node scripts/verify-redis-restart-qa.js
```

The backup tool exports **all** staging application collections, including auth,
using existing credentials inside the Mongo container without logging them. It
does not write staging DB/container files. The BSON archive, full CA storage and
Caddy configuration are stored under a new `backups/v1-*` folder with owner-only
Windows ACLs (0700/0600 on POSIX). Never publish these archives: auth hashes, session
digests and CA private keys are sensitive. The tools retain all backups/evidence
and refuse to overwrite the manifest/report or an existing restore database.
`verify-backup.js` now forwards to this safe tool; its legacy hardcoded source and
automatic backup/database deletion were removed.

Restore uses a newly named QA database and compares canonical BSON document hashes,
counts, collection types/options and indexes. It pauses the QA TTL monitor only
while comparing expired records, then restores TTL processing in `finally`. It
does not disable staging TTL. Source manifests are checked before/after export;
this demonstrates an unchanged observed export window, **not** a transactional
snapshot on standalone MongoDB. For larger/continuously changing production data,
use a suitable consistent snapshot procedure instead. Verification is bounded to
10,000 documents per logical collection and128MiB command output.

The source staging inventory contained7 users and0 sessions at backup time. A
separate synthetic fixture was therefore BSON-dumped/restored and tested against
the actual authentication middleware:3 password hashes verified,3 pre-backup
sessions authenticated as ADMIN/OPERATOR/VIEWER, and a disabled account's restored
session rejected. No restored staging account was logged into the QA web app.

Caddy QA restores the original CA and uses two successive containers with the same
data/config volumes; both HTTPS requests must pass certificate validation and
return200. Redis QA stops the worker, accepts one real REST job, restarts Redis,
checks that job remains queued, restarts the worker and requires exactly1 reading.
This verifies graceful AOF restart durability, not sudden host power-loss survival.
The configured every-second fsync can have a loss window under abrupt power loss.

## Log lifecycle

Runtime logs use a random session suffix as well as service/PID, so a reused PID
does not truncate an earlier worker session. Rotation remains5MiB per file with3
archives. Retention runs at startup and every60seconds, handling both services and
older sessions in the configured runtime directory:

- Default max age:7days (`SENSORGUARD_LOG_MAX_AGE_DAYS`).
- Default total managed-log target:100MiB (`SENSORGUARD_LOG_MAX_TOTAL_BYTES`).
- Delete oldest eligible managed regular files first; ignore foreign names,
  directories and symlinks. Never recurse into evidence/backups.
- Protect the logger's current file and files modified in the past2minutes. The
  target can be temporarily exceeded by active/recent logs; `stats.overBudget`
  exposes this rather than deleting active or just-written error evidence.
- Preserve historical QA volumes. New release QA uses its own `release_logs`
  volume; `scratch/` evidence and `backups/` are never cleanup targets.

Tests exercise age and size pruning, budget pressure, rotation, restart-session
preservation, redaction and symlink exclusion on Linux. Windows runs skip only
the symlink test when lacking creation privileges; Docker/CI runs execute it.
New base deployments use a persistent app-log volume with a short networkless
ownership-init service; apps remain non-root. Existing staging was not recreated
and continues its previous file-log configuration and bounded Docker stdout logs.
Do not apply the updated deployment to that instance without approved maintenance.

## Release QA and regression

```powershell
docker compose -f deploy/compose.apm-qa.yml build api
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.release-qa.yml up -d --no-build --wait
docker compose -f deploy/compose.apm-qa.yml run --no-deps -T regression
docker compose -f deploy/compose.apm-qa.yml exec -T -e SENSORGUARD_APM_QA=true -e DD_TRACE_ENABLED=false api node scripts/verify-intelligence.js
$env:SENSORGUARD_APM_QA='true'
$env:SENSORGUARD_QA_REPORT='scratch/v1-reliability.json'
node scripts/verify-reliability.js
Remove-Item Env:SENSORGUARD_APM_QA,Env:SENSORGUARD_QA_REPORT
npm.cmd run frontend:test
npm.cmd run frontend:typecheck
npm.cmd run frontend:build
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.release-qa.yml stop
```

Report files intentionally refuse overwrite; select a new explicit report name
for another verification pass. Run E2E/fault tests sequentially and do not recreate
QA apps during a run. No Agent/Cloud collection is started by this overlay.

Required gates: real Mongo regression, frontend/typecheck/build, actual telemetry /
incident/RCA/recovery/demo E2E, reliability, full BSON/auth/session/TLS restore,
Redis restart durability, retention, secrets/dependency scans, staging preservation
and exact-head CI. Release notes and the final verification asset record actual
counts, commit and CI. Source archives are supplied automatically by GitHub.

No files were proved safe/obsolete enough to delete. Operational backup, rollback,
QA and prior reports remain. No dependency was removed; no unrelated frontend or
HA feature was added. Private evidence lives only in ignored `scratch/v1-*` and
`backups/v1-*`, outside public release assets.

## Recorded local acceptance (06/11/2026)

| Gate | Result |
|---|---|
| Real MongoDB7 backend suite | PASS:87 tests,0 failures,0 skipped |
| Frontend | PASS:5 gateway +25 React tests; typecheck/build pass |
| Telemetry / incident / RCA / recovery / Demo Center | PASS:4 real E2E runs,9/9/4/9 readings, VERIFIED recovery |
| Reliability | PASS: storage disconnects, session restart, worker crash/stale/replay, concurrency, manual-resolution fencing,120-second timeout |
| Full staging BSON restore | PASS:11 sensors,59 readings,16 incidents,59 ledger events,7 auth users; hashes/types/options/indexes match |
| Synthetic auth/session restore | PASS:3 password hashes and3 sessions/roles; disabled-session rejection |
| Redis restart | PASS: queued REST job preserved, then exactly1 stored reading |
| CA restore | PASS: original CA, HTTPS200 in2 successive QA containers |
| Retention / rotation | PASS:4 Docker tests; live restart preserved7 prior worker files including1 error line and created a new session file |
| Security | PASS: dependency audits0 vulnerabilities; pattern scan and Compose validation; no secrets published |
| Staging | PASS: container identities and CA unchanged, readiness/HTTPS200; read-only operations only |

Evidence also retains earlier verifier failures: HTTP response status was initially
confused with its `queued` body field, a structured queue-close log required JSON
result framing, and a restart assertion initially expected identical file hashes.
Graceful shutdown legitimately appends a final log line; the corrected check
requires every old byte to remain as a prefix. These were verifier corrections,
not disabled assertions or changes to ingestion semantics. Sandbox-restricted
Windows temp rotation initially failed; elevated Windows and real Docker/CI
verification are reported separately. No failed evidence was deleted.

Final PR/main CI, release commit and asset checks are recorded in the GitHub
release verification asset. The historical Cloud/HA limitations remain explicitly
outside this hackathon's release gates, not silently marked verified.
