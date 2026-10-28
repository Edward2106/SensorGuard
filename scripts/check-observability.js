// Offline consistency lint, NOT Datadog Cloud/API schema validation.
import { readFileSync } from 'node:fs';
import { METRICS } from '../src/observability/metrics.js';
const dashboard = JSON.parse(readFileSync('monitoring/dashboard.json'));
const monitors = JSON.parse(readFileSync('monitoring/monitors.json'));
if (dashboard.layout_type !== 'ordered' || !Array.isArray(dashboard.widgets) || !Array.isArray(monitors)) throw Error('Invalid template structure');
const references = new Set();
for (const document of [dashboard, monitors]) {
  for (const match of JSON.stringify(document).matchAll(/sensorguard\.([a-z_.]+)\{/g)) {
    const name = match[1], base = name.replace(/\.(avg|max|min|median|\d+percentile)$/, '');
    if (!Object.hasOwn(METRICS, name) && !Object.hasOwn(METRICS, base)) throw Error('Unimplemented custom metric: ' + name);
    references.add(name);
  }
}
for (const monitor of monitors) {
  if (!monitor.name || !monitor.query || !monitor.options?.thresholds || monitor.message.includes('@')) throw Error('Review monitor structure or notification recipient');
}
console.log(JSON.stringify({ status: 'LOCAL VERIFIED', cloud: 'UNVERIFIED', dashboardWidgets: dashboard.widgets.length, monitors: monitors.length, references: [...references] }));
