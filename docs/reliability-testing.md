# Reliability testing and configuration history

## Isolated regression

```powershell
$env:PHASE9_TEST_MONGO_URI='mongodb://127.0.0.1:27029'
$env:DD_TRACE_ENABLED='false'
$env:SENSORGUARD_METRICS_ENABLED='false'
npm.cmd test
npm.cmd run frontend:test
npm.cmd run frontend:typecheck
npm.cmd run frontend:build
node scripts/check-observability.js
node scripts/secret-check.js
git diff --check
```

MongoDB tests verify the dedicated port/dbPath and use fresh QA database names. They retain fixtures; no reset/drop is needed. Missing QA URI means integration tests are skipped, not passed. Run regression separately from failure injection.

`scripts/verify-intelligence.js`, executed inside the QA API, sends three scenarios and repeats overheating. It checks role boundaries, global lease conflict, concurrent approval, three new recovery events and durable readings. QA credentials are random, temporary, never printed and normally disabled on completion.

`scripts/verify-reliability.js` is a host-side finite test restricted to the named hardening QA project. It checks API restart/session persistence, Redis/Mongo disconnect fail-closed behavior, concurrent demo HTTP requests, SIGKILL and stale heartbeat, BullMQ replay without duplicate readings, manual acknowledge/resolve and concurrent verification. It also waits for a real 120-second recovery timeout on an isolated sensor with no recovery evidence. It restores stopped QA services in `finally` and records failures. Do not interrupt another user's test to run it.

The lease test starts a processor after its lease has been replaced/expired and verifies no telemetry or sensor is created and the successor lease is preserved. This does not prove every in-flight network-partition/zombie-worker interleaving. Replica-set election/failover is UNVERIFIED without a suitable isolated replica set. A standalone MongoDB test is not an HA test.

## Threshold history contract

Each sensor configuration write through `SensorService` atomically updates the active values, increments `configurationRevision` and appends a `thresholdHistory` entry when type/unit/thresholds/detectionSettings change. Metadata-only edits do not manufacture revisions. Every entry includes actor ID/role, previous/new values, server-assigned `effectiveAt`, `recordedAt`, previous hash and content hash. CAS fences concurrent revisions and legacy direct writers. Hashes aid tamper detection; they are not a signature or protection from a privileged database administrator.

`effectiveAt` is a monotonically increasing server-assigned boundary for event-time configuration lookup; clients cannot backdate it. `recordedAt` is the server timestamp allocated for the atomic write, not a separately measured commit acknowledgement. Very fast changes can place the boundary a millisecond later. `receivedAt` remains API enqueue time, distinct from event time and worker retry time. Replay does not refresh receipt identity.

There is no backfill: legacy sensors gain their first proven revision only at the first configuration change; `previous` records what the API observed before that write, not how long it had been effective. Before the first retained revision return `HISTORICAL_THRESHOLD_UNAVAILABLE`. The live legacy detector keeps its existing processing-time behavior and records unavailable historical provenance explicitly. For readings inside retained history, the detector evaluates the corresponding revision and stores it in incident opening history. Out-of-order readings remain subject to the live detector's monotonic safeguards.

History is API append-only, capped at 256 revisions per sensor; reaching the cap rejects further configuration changes with409 and never truncates old evidence. Archival requires a separate additive plan. This is not unlimited industrial configuration retention. Global environment default changes are not a versioned deployment history; scalar detector thresholds/opening evidence and explicit sensor settings remain the available evidence.

`GET /api/v1/sensors/:sensorId/threshold-history` is authenticated and bounded; callers cannot increase its limit. Sensor create/update retain existing role/CSRF rules. Analytics returns time segments and per-bucket historical configuration. A bucket spanning multiple revisions, unknown history or incompatible type/unit has no threshold line. Current thresholds are not used as a historical fallback. Analytics still filters the current sensor type/unit; it is not a multi-unit conversion engine. Late-arriving telemetry can change event-time aggregates; ingestion-time as-of backtesting is not implemented.

Recovery configuration fingerprints include the revision: changing settings and changing them back invalidates an unapproved old proposal. Approval/verification still requires the actual detector's automatic resolution and three distinct post-approval safe events. A demo finishing with failure moves its own sensor to maintenance; the verifier may then return FAILED because monitoring/configuration changed. This is distinct from a workflow that actually waits120seconds without evidence and becomes TIMED_OUT. Neither is VERIFIED.
