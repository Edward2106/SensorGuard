# SensorGuard release audit — 06/11/2026

## A. Summary and scope

This audit starts from `Edward2106/SensorGuard` main commit `46680a2ab22eada52f2fd5b65d372f3ac175118c`. It covers the GitHub snapshot, targeted source/configuration inspection, local regression, dependency audit and documentation. It is not a complete production certification or an audit of the owner's current Windows working tree.

Execution: Linux, Node.js 24.22.1, npm 11.9.0. The requested Windows directory, Docker engine, MongoDB/Redis services and logged-in Datadog account are unavailable here. Browser inventory contained no open tabs. No Cloud data was sent.

The four supplied APM QA paths are absent from the GitHub snapshot:

- `deploy/compose.apm-qa.yml`
- `scripts/apm-qa-receiver.js`
- `scripts/verify-apm-qa.js`
- `tests/apm-receiver.test.js`

The previous report's 608 traces, 1,648 spans and 73 backend passes cannot be independently verified from this checkout. They must not be attributed to this run. Compare the uncommitted Windows changes before merging this branch into that working tree.

## B. Confirmed bugs and fixes

| Finding | Impact | Change / evidence |
|---|---|---|
| Metrics transport hardcoded `127.0.0.1` | Medium: a separate Docker Agent could not receive metrics even with `DD_AGENT_HOST` configured | Honor `DD_AGENT_HOST`, retain loopback default; real UDP reception tested on `127.0.0.2` |
| Observed launcher did not forward termination signals | Medium: parent termination could interrupt observed API/worker cleanup in container deployments | Forward SIGINT/SIGTERM, await child exit and preserve failures; test includes a real child completing cleanup after SIGTERM |
| Remote configuration was not explicitly disabled in observed startup | Configuration gap against the requested minimal QA feature set | Set `DD_REMOTE_CONFIG_ENABLED=false` alongside existing disabled optional features |
| Secret scanner claimed to scan only tracked files | Low: misleading audit coverage message | Report the count of tracked plus non-ignored untracked files actually scanned |

No replacement instrumentation system was introduced. No claim is made that these tests validate Datadog Agent ingestion or tracing across BullMQ.

## C. Datadog verification

| Component | Status in this run | Evidence / missing prerequisite |
|---|---|---|
| Instrumentation | Configuration reviewed; runtime ingestion UNVERIFIED | ESM tracer preload retained; launcher tests pass; earlier protocol receiver is absent |
| Real Agent | BLOCKED | No Docker engine or Agent runtime available |
| Cloud APM | BLOCKED | No logged-in organization, quota/budget evidence or Agent |
| Cloud Logs | BLOCKED | No authorized running Cloud collection pipeline |
| Cloud custom metrics | BLOCKED | Local UDP transport verified only |
| Dashboard | Template consistency PASS; Cloud UNVERIFIED | Offline lint: 10 widgets; no deployed dashboard inspected |
| Monitors | Template consistency PASS; Cloud UNVERIFIED | Offline lint: 6 monitors; no deployed status inspected |
| Telemetry distributed trace | UNVERIFIED | Requires actual API, BullMQ, worker, database and trace evidence |

Reviewed metric names/types and existing bounded service/environment tags. Global gauges remain opt-in for one designated worker. Recovery and workflow series retain separate opt-in flags. The heartbeat metric is a counter for successful heartbeat writes, not an availability gauge. Logger code retains JSON output, size rotation and active-span correlation; Cloud parsing and time-based retention were not tested. Files are per PID, so rotation alone does not bound retention across all restarts.

## D. Reliability and HA

Verified the observed launcher's forwarding to a real Linux child, its cleanup completion and exit propagation. Existing unit checks for heartbeat, recovery, concurrency and workflow metrics passed where independent of MongoDB.

API/worker fault injection, Redis/Mongo disconnects, queue retries/duplicates, concurrent approvals/demos, durable session restart, recovery timeout and Mongo replica-set election were not executed here. `scripts/verify-reliability.js` requires named isolated Docker fixtures and was not pointed at another environment. Standalone MongoDB/Redis in `deploy/compose.yml` do not establish HA. No API HA or Redis HA claim is made.

## E. Code cleanup

- Files deleted: none; no file was proved obsolete enough to remove safely.
- Refactored: `scripts/start-observed.js`.
- Corrected: `src/observability/metrics.js`, `scripts/secret-check.js`.
- Improved diagnostics: `src/worker.js` retains up to four redacted startup stack frames without the exception message.
- Rewritten: `README.md`; removed historical deployment counts, repeated phase narratives and fixed historical PASS totals from the entry document.
- Added: two regression test files and this report.
- Dependencies removed: none.
- Retained: source, Compose overlays, backup/restore tools, tests and operational docs. Their purpose or references did not justify removal. Generated dependencies/build output remain ignored.
- Windows untracked files and prior test evidence were unavailable and were not deleted.

## F. Local testing

| Check | Result |
|---|---|
| Backend `NODE_ENV=test npm test` | 67 total; 61 passed; 0 failed; 6 skipped; 0 cancelled |
| Frontend gateway boundary tests | 5 passed; 0 failed; 0 skipped |
| Frontend React tests | 25 passed; 0 failed; 0 skipped |
| Frontend typecheck | PASS |
| Frontend production build | PASS |
| Observability template lint | PASS; offline consistency only |
| Secret pattern scan | PASS for checked-out tracked and non-ignored untracked files; not a history scan |
| Git whitespace check | PASS |
| Backend production dependency audit (`--omit=dev`) | 0 vulnerabilities reported |
| Full backend dependency audit | 2 moderate entries: minimatch and its dependent nodemon |
| Frontend dependency audit | 0 vulnerabilities reported |
| Docker Compose runtime validation, healthchecks, actual Agent and E2E | BLOCKED locally |

Six skipped tests require the dedicated real MongoDB fixture: analytics, incident analysis, recovery, threshold history, demo safety and demo lease. Skipped tests are not passes. GitHub CI results must be read for the exact branch head; historical main success is not validation of this change.

### GitHub CI evidence

[Verify run 42085449943](https://github.com/Edward2106/SensorGuard/actions/runs/42085449943), commit `3d5e1ca2f7bae01f5d6de443540a5ecb6f231fc6`, succeeded on Ubuntu / Node.js 22:

- Backend with real MongoDB: **76 passed, 0 failed, 0 skipped**.
- Frontend: **5 boundary + 25 React tests passed**; typecheck and build succeeded.
- Docker image build and Compose configuration validation succeeded.
- Actual API/BullMQ/worker/MongoDB E2E verified Server Overheating twice, Pump Vibration and Connection Loss, each with verified recovery; final report `success: true`.
- Observability template lint, secret scan and dependency audit at the workflow's high-severity threshold succeeded. The two moderate development-tool entries remain.

An earlier pull-request run, [42085005133](https://github.com/Edward2106/SensorGuard/actions/runs/42085005133), failed when the worker exited with a startup TypeError after MongoDB connection. The simultaneous push run on the **same** initial SHA passed. No error message/stack was present in the original worker log. Bounded redacted stack frames were added for future diagnosis; the subsequent run above passed. **The intermittent startup failure's root cause is unresolved.** A later green run does not prove that defect fixed; keep it as an open release gate and collect a stack if reproduced.

These CI services are disposable runner fixtures, not the owner's staging or current Windows QA stack. They establish the checks above, not real Agent/Cloud ingestion, HA, or staging preservation.

## G. Security

No credentials were added or rotated. No firewall, account permissions or staging authentication were changed. Existing authentication, role authorization, CSRF/session handling and error logging were inspected at source level, with existing applicable unit tests passing. This was not a penetration test or exhaustive race/dead-code analysis.

`npm audit fix --ignore-scripts` did not resolve the two moderate development-tool entries. Its unrelated lockfile changes were discarded. No forced major dependency migration or vulnerability suppression was introduced. Production dependencies report zero advisories in this run; this does not establish absence of security defects.

Remaining checks include full Git history secret scanning, actual Cloud log/tag redaction, deployment credentials and access controls, runtime DB indexes, backups/restores, network isolation, and time-based log retention across process restarts.

## H. Docker and staging preservation

No Docker commands changed services, images, networks, volumes, databases, sessions or certificates. The Windows staging environment was not accessible, so current health, container IDs, data counts and CA checksums remain UNVERIFIED. This run cannot certify staging preservation by comparison; it can attest that it performed no staging operations.

The inspected deployment has a private internal network, resource limits, non-root app image, read-only app filesystem, bounded container logs and persistent database/TLS volume declarations. Compose merging and actual deployment behavior require Docker verification with the existing env file and overlays. QA was not started here.

## I. GitHub

Changes are prepared on `fix/observability-release-audit`, based on the main SHA above. Commit, PR URL and exact-head CI results are reported with the delivery. The PR is kept as a draft while current Windows APM files, real Agent/Cloud and staging verification remain outstanding. No force push, history rewrite or branch-protection bypass is part of this work.

## J. Remaining release gates

1. Supply access to the current Windows checkout, including the four APM QA files and prior evidence; compare local changes before applying this branch.
2. Inventory staging container IDs, mounts and trusted CA using read-only checks.
3. Run complete QA regression with real MongoDB/Redis, reliability scenarios and Docker configuration/healthchecks.
4. Run a real Agent on isolated QA; verify successful and abnormal telemetry, retries and recovery, and inspect actual trace relationships across asynchronous boundaries.
5. Verify the intended US5 organization and sufficient free quota or an explicit budget before any Cloud submission.
6. Verify Cloud APM, logs, custom metrics, dashboards and monitors individually with service/environment/time-window evidence.
7. Resolve or explicitly track the development-only dependency advisory and log retention limitation.
8. Investigate the intermittent worker startup failure; do not treat the successful subsequent run as a proven fix.
9. Only claim MongoDB/Redis/API HA after a corresponding topology and failover test exist. Review backup restoration and remaining security controls before a production release.

Production readiness is not established by the passing local tests or by the draft PR.
