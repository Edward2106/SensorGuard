# Windows PR #1 acceptance — 06/11/2026

Starting PR head: `4a7f369d39e45aca65062affb316f607689e15a2` on
`fix/observability-release-audit`. Windows main was46680a2. The modified README and
four untracked APM files were backed up intact in ignored
`scratch/pr1-windows-original/` before switching branches. These paths were absent
from the PR; they are integrated while retaining the PR's newer launcher, storage
and metrics fixes. Relevant local README instructions moved to [APM QA](apm-qa.md).

## Acceptance

| Item | Status | Evidence / boundary |
|---|---|---|
| Windows checkout / PR alignment | PASS | Exact starting head matched; original local files preserved |
| Four local APM files integrated | PASS | Default sink retained; optional fixed-host Agent proxy added |
| Real Agent ingestion | PASS, offline | Official Agent7.85.1 pinned by digest; internal network, no host ports/socket/Cloud key |
| Distributed telemetry | PASS, scoped | Actual REST/BullMQ/worker/Mongo spans;7 shared trace IDs and56 cross-service producer-consumer parent edges |
| Incident/RCA/recovery | PASS | Final four scenarios VERIFIED:9/9/4/9 readings;3 new recovery events per run |
| Cloud APM/Logs/Metrics sending | BLOCKED | Organization/site inspected; free quota/budget not established |
| Cloud APM/Logs/Metrics delivery | UNVERIFIED | No new Cloud data sent; local intake does not prove Cloud indexing |
| Cloud dashboards / monitors | UNVERIFIED operationally | SensorGuard dashboard search empty; monitors onboarding; no resources created |
| Reliability | PASS for exercised scenarios | Report success=true; restart/session, storage disconnect, worker crash/stale/replay, concurrency, false-success fencing and120-second timeout |
| Mongo3-member failover | PASS, driver scope | Actual election; same client majority write;2 documents on all3 nodes after old primary rejoined |
| Full application / Redis HA | UNVERIFIED | No matching failover topology exercised |
| Staging preservation | PASS for read-only checks | Original8 running identities unchanged, including all5 staging services; no staging mutations/fault injection |
| Dependencies | PASS at audit time | Backend moderate2 to0; frontend0; scoped nodemon dependency override and real watch restart |
| Cleanup | PASS, conservative | No files/dependencies/data/volumes deleted; backup/evidence/credentials/rollback retained |
| Regression | PASS | Backend83/83,0 skipped on real QA Mongo7; frontend5 gateway+25 React; typecheck/build pass |
| Secrets / Compose | PASS locally | Pattern scan, whitespace, both QA topologies validated; not a Git-history security certification |
| Ready for Review / merge | NOT PERFORMED | Draft retained because Cloud/budget acceptance remains blocked |

## Datadog evidence

Agent7.85.1 runs without an egress route. A deliberately invalid placeholder key
satisfies its startup check; output goes to a local HTTP sink that discards bodies.
No Windows Agent, firewall or account settings were changed. No real key was read,
copied into files or committed. Profiling, AppSec, data streams, instrumentation
telemetry and remote configuration remain disabled.

Final recorder snapshot:315 original SDK payloads forwarded,2,524 unique low64-bit
trace IDs,14,874 unique spans (API10,855; worker4,019),0 rejected payloads and0
forward errors.78 error spans occurred during actual QA/fault exercises, not manual
span generation. RCA and human approval are separate HTTP traces. The recorder
keeps bounded graph metadata, not tags, resources, URLs or telemetry bodies.
Default mode never forwards; Agent mode allows only `http://agent:8126` and forwards
original bytes unchanged. Unit protocol fixtures never feed the live receiver.

Agent status snapshot: LogsProcessed764/LogsSent764;18,175 DogStatsD metric packets.
Packet totals include Agent metrics, not only application metrics. The separate
`agent dogstatsd-stats` output shows actual named SensorGuard API, telemetry,
detection, queue, sensors, incidents, heartbeat, demo and recovery series with
bounded service/env tags. A metric not triggered by a real event is not claimed
nonzero. Per-file log rotation exists; retention across PID restarts is not
time-bounded. Local sink acceptance does not prove Cloud schema acceptance.

Read-only US5 UI observations in the signed-in organization:

- Usage:1 infrastructure host; APM/log/spans show dashes. Trial Management: no
  trials available. Neither establishes free quota or an authorized spend ceiling.
- APM: all-environment service list empty for the displayed past-week window.
- Logs Explorer:0 logs in its displayed15-minute window.
- Metrics Overview:0 custom metrics in the displayed past month.
- Dashboard search for SensorGuard: no results. Monitors: onboarding/templates.

These observations do not prove absence across all historical periods. No trial,
paid feature, dashboard or monitor was activated, and no Cloud ingestion occurred.
Session tokens were not extracted. Cloud verification remains blocked until quota
or an explicit budget is established.

## Corrections and retained failures

- Agent init initially failed on s6 ownership operations, then on its required key
  environment variable. Added only init capabilities and the invalid offline
  placeholder; no privileged mode or host mounts.
- Root-owned fresh QA log volume prevented app writes. A networkless init service
  assigns that volume to UID1000. Apps stay non-root; Agent reads logs read-only.
- Initial E2E was interrupted by QA app recreation after2 VERIFIED scenarios;
  CONNECTION_LOSS failed and was retained. The subsequent complete4-scenario rerun
  succeeded.3 users from the interrupted run were disabled at final cleanup;
  normal E2E and reliability users were disabled by their scripts.
- Added `DD_DOGSTATSD_HOST` before the existing `DD_AGENT_HOST` fallback, allowing
  UDP metrics to bypass the trace proxy. Regression coverage preserves defaults.

## Dependency compatibility

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) affects
minimatch7 through10; the patched line starts11.0.1. Nodemon3.1.14 still requests
10.x. A scoped override selects11.0.5 only for nodemon development tooling. No
runtime major upgrade or `audit fix --force` was used. Matcher API, ignored-file
filtering and actual file-change restart passed on Windows. CI repeats that smoke
test. Backend/frontend audits report0 vulnerabilities at this run; future advisory
coverage can change.

## Staging and QA disposition

Read-only inventory: Mongo7.0.45,11 sensors,59 Time Series readings,16 incidents,
59 telemetry events. Time Series options retained: timestamp/metadata, seconds,
30-day expiry. HTTPS200 with `rejectUnauthorized=true` against original public CA;
SHA256 `08b01169cd32ffbbdf619219c506ad3718c0969e7e890321edb064134151533d`.
Container IDs, mounts/networks and volumes were inspected without exposing env
secrets. Inventory was collected during verification, not at its initial second;
no byte-for-byte database comparison is claimed. Normal background detector updates
remain possible. No staging demo, seed, migration or fault injection ran.

Replica-set QA had three512MiB Mongo nodes on another internal network. Majority
writes survived rs1 to rs2 election using the same client. After rs1 rejoined,
all3 nodes were healthy and contained both documents. This is a small correctness
test, not a latency benchmark or full application HA test. Redis/API HA and
multi-host partitions remain unverified.

QA was stopped after0 active demo runs and0 VERIFYING_RECOVERY workflows. All
volumes, records and evidence remain. No file was proved obsolete enough to delete.
No external repository was modified. Private evidence is ignored in `scratch/pr1-*`:
regression/build logs, Agent counters/graph, E2E/reliability/failover outputs,
staging inventory/topology/CA/HTTPS and final GitHub CI result. No production-ready
certification is made. PR stays Draft; no merge is authorized by these results alone.
