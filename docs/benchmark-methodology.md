# Benchmark methodology and comparison limits

Run only on dedicated QA, with API/worker/fault tests idle. Never add an index to staging based on these measurements. Keep raw samples, plans, version, fixture size, resource samples and unfavorable outcomes.

```powershell
$env:PHASE9_TEST_MONGO_URI='mongodb://127.0.0.1:27029'
node scripts/benchmark-analytics.js
```

The script creates a fresh fixture:240,000 readings,4 sensors,60,000 readings per sensor. One query returns1,000 UTC buckets. Before/after a fixture-only index, each side uses5 warm-ups+50 measured samples, with the same pipeline/options and no hint. It captures `explain('executionStats')`, storage indexes, client latency and separate insert batches. It does not delete its fixture. Resource metrics are Docker snapshots, not controlled workload resource benchmarks.

Report p50/median, p95,p99 and raw samples. With n=50 the reported p99 is the maximum. Before/after order is not randomized; warm cache, OS scheduling and background I/O matter. A single explain timing can disagree with client latency. Single-node write settings are not a durable replica-set production SLA. Compare identical measurement definitions, not whichever number favors the change.

Historical measured results retained: MongoDB8.3.2 median99.46→105.63ms after index (worse); MongoDB7.0.45 median103.93→89.21ms, p95149.77→116.31ms, p99173.85→125.63ms. In the latter run, one explain sample82→105ms and insert batch median10.46→10.93ms worsened. These are historical runs, not the hardening release's new measurements. New raw results are recorded in ignored scratch evidence and the release report.

Hardening run29/10/2026, MongoDB7.0.45: index comparison p50 72.95→73.73ms (worse), p95 77.13→79.93ms (worse), p99 87.33→81.24ms; cursor docs240→60, keys0→61, one explain68→68ms. Write-batch p50 7.74→8.41ms (worse), p95 11.95→10.40ms, p99 15.55→11.24ms. No index was applied to staging.

The first service-cost probe found0-vs256history median80.28→226.96ms. The implementation was then changed from rescanning all revisions per bucket to sweeping precomputed segments once. A separate paired old/new probe on the exact retained256revision fixture verified full response equality before measuring: p50 228.35→109.43ms, p95 278.67→168.69ms, p99 301.95→200.91ms. This is a measured improvement for that workload, not a general SLA. Raw files: `scratch/phase9-benchmark-1793207210341.json` and `scratch/hardening-history-benchmark-1793207359339.json`, including source hashes and samples.

To reproduce the paired service comparison in the audited workspace:

```powershell
node scripts/benchmark-history-annotation.js scratch/phase9-benchmark-1793207210341.json
```

This requires the retained pre-optimization source artifact and the same fixture. It fails closed if those are missing or the scratch output module already exists; do not overwrite evidence merely to rerun. On a fresh clone use the primary fixture benchmark; a paired historical-code comparison requires retaining both versions explicitly.

## Read-only comparator review

Current review pinned to [ddloi/sensorguard-iot609aff519f19184b26c85512147a7a0beaf7108d](https://github.com/ddloi/sensorguard-iot/commit/609aff519f19184b26c85512147a7a0beaf7108d). This supersedes the older static review at77c6328. No source is copied into this repository, no author credentials are used and no comparator environment is modified.

| Area | SensorGuard Edward | Comparator source observation | Evidence limit |
|---|---|---|---|
| Architecture | Express, BullMQ, Mongo Time Series, separate API/worker | Fastify, BullMQ, Time Series | Static architecture, no relative throughput measured |
| Analytics | Prior-only baseline, Z-score/EWMA, bounds and resource budgets | Current-inclusive moving window and response cache in [analytics route](https://github.com/ddloi/sensorguard-iot/blob/609aff519f19184b26c85512147a7a0beaf7108d/packages/api/src/routes/analytics.ts) | Different definitions; latency/accuracy NOT COMPARABLE |
| Detection/RCA | Rule hypotheses and evidence; monotonic/hysteresis detector | README describes alert grouping/detection | No independent labeled dataset; precision/recall/F1 UNVERIFIED |
| Recovery | Human approval,3 new safe events plus detector confirmation | [Remediation worker](https://github.com/ddloi/sensorguard-iot/blob/609aff519f19184b26c85512147a7a0beaf7108d/packages/api/src/workers/remediation.worker.ts) uses delayed two-stage jobs and updates resolution | Different runtime contracts; no whole-system correctness ranking |
| Live UX | Controlled polling, explicitly labeled | README and workers describe WebSocket delivery | Comparator has streaming code; Edward does not claim WebSocket parity |
| Security | Auth/RBAC/session/CSRF tests run locally and CI | Not independently audited | NOT COMPARABLE |
| Observability | Local counters/template lint; Cloud unverified | README claims Cloud integration | Claims do not establish comparable delivery/coverage |
| Tests | Actual release counts and integration evidence | README badge reports32; not rerun here | Test totals are not coverage or quality scores |
| CI/CD | Tests are required; verify exact release SHA | [CI file](https://github.com/ddloi/sensorguard-iot/blob/609aff519f19184b26c85512147a7a0beaf7108d/.github/workflows/ci.yml) marks test steps continue-on-error | Static workflow observation, no claim its tests fail |
| Demo quality | Three scenarios exercised on isolated QA | SCADA/demo features described in README | No equivalent browser/runtime experiment |

No equal-resource, equal-workload run of the comparator was performed; runtime/latency/throughput/memory comparisons are NOT COMPARABLE. Do not assign arbitrary scores or declare overall superiority. A future comparison needs compatible schemas, isolated credentials/data, license review, equal Mongo/resource versions, warm/cold protocols and independently labeled anomaly cases.

GitHub Actions modernization was checked against official [checkout v6.1 guidance](https://github.com/actions/checkout/tree/v6.1.0) and [setup-node v6.5 guidance](https://github.com/actions/setup-node/tree/v6.5.0): Node24 action runtime requires a modern runner; the app itself stays Node22 in CI/Docker. Runner is pinned to Ubuntu24.04 and action commit SHAs are pinned; actual CI execution remains the release gate.
