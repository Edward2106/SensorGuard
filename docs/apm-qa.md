# Offline Datadog Agent QA

This is a standalone Docker QA project. Never combine these files with staging
Compose files or pass `.env.staging`. No service publishes host ports. The network
is `internal`; neither applications nor Agent have Internet egress. An invalid,
clearly labelled API-key placeholder satisfies Agent startup only. No Cloud key,
Docker socket or sensitive host directory is mounted.

## Run from Windows PowerShell

```powershell
docker compose -f deploy/compose.apm-qa.yml build api
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.apm-agent-qa.yml up -d --no-build --wait
docker compose -f deploy/compose.apm-qa.yml exec -T -e DD_TRACE_ENABLED=false api node scripts/verify-apm-qa.js
docker compose -f deploy/compose.apm-qa.yml exec -T -e SENSORGUARD_APM_QA=true -e DD_TRACE_ENABLED=false api node scripts/verify-intelligence.js
docker compose -f deploy/compose.apm-qa.yml run --no-deps -T regression
```

Wait for each command to finish before recreating API/worker containers. The
read-only verifier upserts one maintenance sensor; the intelligence verifier
creates isolated simulated sensors, ingests telemetry through REST/BullMQ and
requires actual detector-confirmed recovery. It disables its temporary users on
normal completion. Interruption requires checking active runs and temporary users;
do not reset the database or erase evidence to recover a test.

The base Compose file alone uses a protocol sink. The Agent overlay opts that sink
into forwarding the **original** MessagePack bytes only to `http://agent:8126`.
It counts actual producer/consumer parent edges and rejects any other upstream.
No spans are fabricated. Trace context across BullMQ is automatically instrumented
by dd-trace; RCA/approval HTTP requests are separate traces. Data Streams, profiling,
AppSec, remote configuration and instrumentation telemetry remain disabled.

`DD_DOGSTATSD_HOST=agent` keeps UDP metrics separate from the trace capture proxy.
Only one worker owns global gauges. Logs use a QA-only shared volume, initialized
for UID1000; the Agent mounts it read-only. The real Agent forwards APM, logs and
metrics to an offline HTTP sink that discards bodies and counts requests/bytes.
An HTTP200 from that sink proves neither Cloud schema acceptance nor indexing.
Runtime logs now have cross-session age/size retention; see [v1 policy](hackathon-v1.md).
Preserve historical QA evidence outside runtime cleanup directories. Release QA
uses a new log volume so the previous Agent evidence volume remains untouched.

```powershell
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.apm-agent-qa.yml exec -T agent agent status -j
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.apm-agent-qa.yml exec -T agent agent dogstatsd-stats
$env:SENSORGUARD_APM_QA='true'
node scripts/verify-reliability.js
Remove-Item Env:SENSORGUARD_APM_QA
docker compose -f deploy/compose.apm-qa.yml -f deploy/compose.apm-agent-qa.yml stop
```

The reliability script checks exact container names, Compose ownership and QA
Mongo topology before fault injection. It never targets staging. Its report is
`scratch/pr1-reliability.json`; the earlier hardening report is retained.
Stop preserves all containers, databases and volumes. Do not use `down -v`.

## Evidence boundaries

- **Instrumentation / local receiver:** actual SDK spans and cross-service edges.
- **Real Agent ingestion:** Agent receiver counters, logs processed/sent and actual
  named DogStatsD metrics; offline output counters corroborate forwarding.
- **Cloud:** a separate check requiring verified organization, quota and budget,
  controlled egress and safe key injection. No Cloud sending is configured here.
- **HA:** `compose.mongo-ha-qa.yml` is a separate, small 3-node replica set. The
  verifier expects an external QA-only primary stop after `READY`, then tests the
  same client's majority write and retained data. It is not an application/Redis
  HA test or a benchmark; restart the stopped member and inspect replication.

The receiver uses MessagePack already locked through BullMQ. Its default cap is
10,000 spans; Agent capture mode caps at50,000 spans and2MiB per request. The Agent
image is pinned by digest; refresh only after reviewing and retesting a new image.
