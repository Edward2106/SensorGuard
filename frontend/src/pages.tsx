import { useState, lazy, Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import {
  api,
  useApi,
  useDate,
  usePrefs,
  params,
  Badge,
  Panel,
  State,
  Pages,
  type Sensor,
  type Incident,
  type List,
  type Stats,
  type Reading,
} from './core';

const Chart = lazy(() => import('./Charts'));
const Distribution = lazy(() => import('./Charts').then(m => ({ default: m.Distribution })));

export function Overview() {
  const sensors = useApi<Stats>('sensors/stats');
  const alerts = useApi<Stats>('alerts/stats');
  const recent = useApi<List<Incident>>('alerts?limit=5');
  const readings = useApi<List<Reading>>(
    'readings?limit=8&from=' +
      new Date(Date.now() - 86400000).toISOString().slice(0, 13) +
      ':00:00.000Z'
  );
  const date = useDate();

  return (
    <>
      <h1>Operations overview</h1>
      <p className="subtitle">A live view of your sensor network, telemetry heartbeat, and incident response.</p>
      <State q={sensors} />
      <State q={alerts} />

      <div className="cards">
        <div className="metric">
          <span>Total sensors</span>
          <strong>{sensors.data?.data.total ?? '—'}</strong>
        </div>
        <div className="metric">
          <span>Online sensors</span>
          <strong style={{ color: '#059669' }}>
            {sensors.data?.data.byHealth ? sensors.data.data.byHealth.online ?? 0 : '—'}
          </strong>
        </div>
        <div className="metric">
          <span>Offline sensors</span>
          <strong style={{ color: '#b91c1c' }}>
            {sensors.data?.data.byHealth ? sensors.data.data.byHealth.offline ?? 0 : '—'}
          </strong>
        </div>
        <div className="metric">
          <span>In maintenance</span>
          <strong>{sensors.data?.data.byStatus.maintenance ?? (sensors.data ? 0 : '—')}</strong>
        </div>
        <div className="metric">
          <span>Open incidents</span>
          <strong style={{ color: alerts.data?.data.byStatus.open ? '#b45309' : undefined }}>
            {alerts.data?.data.byStatus.open ?? (alerts.data ? 0 : '—')}
          </strong>
        </div>
        <div className="metric">
          <span>Critical incidents</span>
          <strong style={{ color: alerts.data?.data.bySeverity?.critical ? '#b91c1c' : undefined }}>
            {alerts.data?.data.bySeverity?.critical ?? (alerts.data ? 0 : '—')}
          </strong>
        </div>
      </div>

      <div className="columns">
        <Panel title="Recent incidents">
          <State q={recent} />
          {recent.data?.data.length === 0 && <p>No incidents recorded.</p>}
          {recent.data?.data.map(i => (
            <Link
              className="list-row"
              key={i.alertId}
              to={'/incidents?sensorId=' + encodeURIComponent(i.sensorId)}
            >
              <div>
                <b>{i.title}</b>
                <small>
                  {i.sensorId} · {date(i.createdAt)}
                </small>
              </div>
              <Badge value={i.severity} />
            </Link>
          ))}
        </Panel>

        <Panel title="Latest telemetry · last 24 hours">
          <State q={readings} />
          {readings.data?.data.length === 0 && <p>No recent telemetry received.</p>}
          {readings.data?.data.map((r, i) => (
            <div className="list-row" key={i}>
              <div>
                <b>{r.metadata.sensorId}</b>
                <small>{date(r.timestamp)}</small>
              </div>
              <strong style={{ fontSize: '15px' }}>
                {r.value} {r.unit || ''}
              </strong>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="Coverage & health notes">
        <p>
          Online/offline totals reflect real sensor health status computed from heartbeat and telemetry windows,
          independent of administrative maintenance status. Historical trends are not exposed by the current aggregate
          API.
        </p>
        <Link to="/health">View dependency readiness probes →</Link>
      </Panel>
    </>
  );
}

function SensorForm({ sensor, done }: { sensor?: Sensor; done: () => void }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api('sensors' + (sensor ? '/' + encodeURIComponent(sensor.sensorId) : ''), undefined, sensor ? 'PATCH' : 'POST', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api'] });
      done();
    },
  });

  return (
    <form
      className="editor"
      aria-label={sensor ? 'Edit sensor metadata form' : 'Register new sensor form'}
      onSubmit={e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const thresholds: Record<string, number> = {};
        for (const k of ['criticalLow', 'warningLow', 'warningHigh', 'criticalHigh']) {
          const val = f.get(k);
          if (val !== null && val !== '') {
            thresholds[k] = Number(val);
          }
        }
        mutation.mutate({
          sensorId: f.get('sensorId'),
          name: f.get('name'),
          type: f.get('type'),
          unit: f.get('unit'),
          status: f.get('status'),
          location: {
            ...sensor?.location,
            facility: f.get('facility') || undefined,
            zone: f.get('zone') || undefined,
          },
          thresholds: Object.keys(thresholds).length > 0 ? thresholds : undefined,
        });
      }}
    >
      <h2>{sensor ? `Edit Sensor: ${sensor.sensorId}` : 'Register New Sensor'}</h2>

      <label>
        Sensor ID
        <input
          name="sensorId"
          required
          minLength={3}
          maxLength={64}
          readOnly={!!sensor}
          defaultValue={sensor?.sensorId}
          placeholder="e.g. SENS-TEMP-101"
        />
      </label>

      <label>
        Device Name
        <input
          name="name"
          required
          minLength={2}
          maxLength={100}
          defaultValue={sensor?.name}
          placeholder="e.g. Boiler Main Temperature"
        />
      </label>

      <label>
        Sensor Type
        <select name="type" defaultValue={sensor?.type || 'temperature'}>
          {['temperature', 'humidity', 'vibration', 'pressure', 'co2'].map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label>
        Measurement Unit
        <input
          name="unit"
          required
          maxLength={20}
          defaultValue={sensor?.unit || 'C'}
          placeholder="e.g. C, %, mm/s, psi, ppm"
        />
      </label>

      <label>
        Operational Status
        <select name="status" defaultValue={sensor?.status || 'active'}>
          {['active', 'inactive', 'maintenance', 'error'].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label>
        Facility / Site
        <input
          name="facility"
          maxLength={100}
          defaultValue={sensor?.location?.facility}
          placeholder="e.g. Building A"
        />
      </label>

      <label>
        Operational Zone
        <input
          name="zone"
          maxLength={100}
          defaultValue={sensor?.location?.zone}
          placeholder="e.g. Floor 2 / North Wing"
        />
      </label>

      <label>
        Critical Low Threshold
        <input
          name="criticalLow"
          type="number"
          step="any"
          defaultValue={sensor?.thresholds?.criticalLow}
          placeholder="Optional"
        />
      </label>

      <label>
        Warning Low Threshold
        <input
          name="warningLow"
          type="number"
          step="any"
          defaultValue={sensor?.thresholds?.warningLow}
          placeholder="Optional"
        />
      </label>

      <label>
        Warning High Threshold
        <input
          name="warningHigh"
          type="number"
          step="any"
          defaultValue={sensor?.thresholds?.warningHigh}
          placeholder="Optional"
        />
      </label>

      <label>
        Critical High Threshold
        <input
          name="criticalHigh"
          type="number"
          step="any"
          defaultValue={sensor?.thresholds?.criticalHigh}
          placeholder="Optional"
        />
      </label>

      <p>
        Thresholds must be strictly ordered: criticalLow &lt; warningLow &lt; warningHigh &lt; criticalHigh. Leave blank
        to disable specific bounds.
      </p>

      {mutation.error && (
        <div role="alert" className="error" style={{ width: '100%' }}>
          {mutation.error.message}
        </div>
      )}

      <div className="btn-row">
        <button disabled={mutation.isPending} className="primary" type="submit">
          {mutation.isPending ? 'Saving…' : sensor ? 'Update Sensor' : 'Register Sensor'}
        </button>
        <button type="button" onClick={done}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Sensors() {
  const role = useAuth()?.role;
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [filter, setFilter] = useState({ type: '', status: '', facility: '', zone: '' });
  const [editing, setEditing] = useState(false);

  const q = useApi<List<Sensor>>(
    'sensors?' +
      params({
        page,
        limit: 20,
        search,
        ...Object.fromEntries(
          Object.entries(filter)
        ),
      }),
    !id
  );

  const detail = useApi<{ data: Sensor }>('sensors/' + encodeURIComponent(id || ''), !!id);
  const qc = useQueryClient();
  const date = useDate();

  const del = useMutation({
    mutationFn: (s: string) => api('sensors/' + encodeURIComponent(s), undefined, 'DELETE'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['api'] }),
    onSuccess: () => {
      window.location.assign('/sensors');
    },
  });

  if (id) {
    return (
      <>
        <Link to="/sensors" style={{ display: 'inline-block', marginBottom: 12 }}>
          ← Back to Sensors
        </Link>
        <h1>{id}</h1>
        <State q={detail} />
        {detail.data && (
          <>
            <Panel title={detail.data.data.name}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
                <Badge value={detail.data.data.status} />
                <Badge value={detail.data.data.healthStatus} />
              </div>
              <p>
                <b>Type:</b> {detail.data.data.type} · <b>Unit:</b> {detail.data.data.unit}
              </p>
              <p>
                <b>Location:</b> {detail.data.data.location?.facility || 'No facility'} /{' '}
                {detail.data.data.location?.zone || 'No zone'}
              </p>
              <p>
                <b>Last seen:</b> {date(detail.data.data.lastSeen)}
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button disabled={!role || role === 'VIEWER'} onClick={() => setEditing(!editing)}>
                  {editing ? 'Close editor' : 'Edit metadata & thresholds'}
                </button>
                <button
                  className="danger"
                  disabled={del.isPending || role !== 'ADMIN'}
                  onClick={() => {
                    if (window.confirm(`Delete sensor ${id}? Its incident history will remain preserved. This action cannot be undone.`)) {
                      del.mutate(id);
                    }
                  }}
                >
                  Delete sensor
                </button>
              </div>
              {del.error && (
                <div role="alert" className="error" style={{ marginTop: 12 }}>
                  {del.error.message}
                </div>
              )}
            </Panel>

            {editing && <SensorForm sensor={detail.data.data} done={() => setEditing(false)} />}

            <Monitoring fixed={id} thresholds={detail.data.data.thresholds} />

            <div style={{ marginTop: 20 }}>
              <Link to={'/incidents?sensorId=' + encodeURIComponent(id)}>View related incidents for {id} →</Link>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="heading">
        <div>
          <h1>Sensor inventory</h1>
          <p className="subtitle">Manage device registrations, operational status, and alerting thresholds.</p>
        </div>
        <button className="primary" disabled={role !== 'ADMIN'} onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : '+ Register sensor'}
        </button>
      </div>

      {editing && <SensorForm done={() => setEditing(false)} />}

      <form
        className="filters"
        onSubmit={e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setSearch(String(f.get('search') || ''));
          setFilter({
            type: String(f.get('type') || ''),
            status: String(f.get('status') || ''),
            facility: String(f.get('facility') || ''),
            zone: String(f.get('zone') || ''),
          });
          setPage(1);
        }}
      >
        <input
          aria-label="Search sensor"
          name="search"
          placeholder="Sensor ID or name"
          defaultValue={search}
          maxLength={100}
        />
        <select aria-label="Sensor type" name="type" defaultValue={filter.type}>
          <option value="">All types</option>
          {['temperature', 'humidity', 'vibration', 'pressure', 'co2'].map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select aria-label="Operational status" name="status" defaultValue={filter.status}>
          <option value="">All statuses</option>
          {['active', 'inactive', 'maintenance', 'error'].map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input aria-label="Facility" name="facility" placeholder="Facility filter" maxLength={100} />
        <input aria-label="Zone" name="zone" placeholder="Zone filter" maxLength={100} />
        <button type="submit">Apply filters</button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setFilter({ type: '', status: '', facility: '', zone: '' });
            setPage(1);
          }}
        >
          Reset
        </button>
      </form>

      <State q={q} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sensor</th>
              <th>Type</th>
              <th>Location</th>
              <th>Status</th>
              <th>Health</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.data.map(s => (
              <tr key={s.sensorId}>
                <td>
                  <Link to={'/sensors/' + encodeURIComponent(s.sensorId)}>
                    <b>{s.name}</b>
                  </Link>
                  <small>{s.sensorId}</small>
                </td>
                <td>{s.type}</td>
                <td>
                  {s.location?.facility || '—'}
                  <small>{s.location?.zone}</small>
                </td>
                <td>
                  <Badge value={s.status} />
                </td>
                <td>
                  <Badge value={s.healthStatus} />
                </td>
                <td>{date(s.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.data.length === 0 && (
          <p style={{ padding: 16, margin: 0, color: 'var(--muted)' }}>No sensors match these filters.</p>
        )}
      </div>

      <Pages page={page} setPage={setPage} data={q.data?.pagination} />
    </>
  );
}

export function Monitoring({
  fixed,
  thresholds,
}: {
  fixed?: string;
  thresholds?: Record<string, number>;
} = {}) {
  const { prefs } = usePrefs();
  const [sensor, setSensor] = useState(fixed || '');
  const [range, setRange] = useState(prefs.range);
  const [windowStart, setWindowStart] = useState(() => new Date(Date.now() - range * 60000).toISOString());
  const date = useDate();
  const [draft, setDraft] = useState(sensor);

  // Load sensors list for autocomplete / selector
  const sensorList = useApi<List<Sensor>>('sensors?limit=100', !fixed);

  const detail = useApi<{ data: Sensor }>('sensors/' + encodeURIComponent(sensor), !!sensor && !thresholds);
  const history = useApi<List<Reading>>(
    'readings?' + params({ sensorId: sensor, from: windowStart, limit: 200 }),
    !!sensor
  );
  const latest = useApi<{ data: Reading | null }>(
    'sensors/' + encodeURIComponent(sensor) + '/readings/latest',
    !!sensor
  );

  const currentUnit = detail.data?.data.unit || latest.data?.data?.unit;

  return (
    <>
      <h1>{fixed ? 'Telemetry history' : 'Real-time monitoring'}</h1>
      <p className="subtitle">
        Controlled polling · {prefs.refresh / 1000}s refresh · bounded to at most 200 readings in the selected window.
      </p>

      <form
        className="filters"
        onSubmit={e => {
          e.preventDefault();
          const target = draft.trim();
          setSensor(target);
          setWindowStart(new Date(Date.now() - range * 60000).toISOString());
        }}
      >
        {!fixed && (
          <>
            <input
              aria-label="Sensor ID"
              placeholder="Sensor ID (e.g. DEV-TEMP-001)"
              required
              value={draft}
              onChange={e => setDraft(e.target.value)}
              list="sensor-options"
              maxLength={150}
            />
            <datalist id="sensor-options">
              {sensorList.data?.data.map(s => (
                <option key={s.sensorId} value={s.sensorId}>
                  {s.name} ({s.type})
                </option>
              ))}
            </datalist>
          </>
        )}

        <select
          aria-label="Time window"
          value={range}
          onChange={e => {
            const newRange = Number(e.target.value);
            setRange(newRange);
            setWindowStart(new Date(Date.now() - newRange * 60000).toISOString());
          }}
        >
          <option value={15}>15 minutes</option>
          <option value={60}>1 hour</option>
          <option value={1440}>24 hours</option>
        </select>

        <button type="submit">Apply / Refresh window</button>
      </form>

      {!sensor ? (
        <Panel title="Select a sensor to monitor">
          <p>Choose any sensor from the inventory, or select one of the suggested sensors below:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {sensorList.data?.data.slice(0, 8).map(s => (
              <button
                key={s.sensorId}
                type="button"
                onClick={() => {
                  setDraft(s.sensorId);
                  setSensor(s.sensorId);
                  setWindowStart(new Date(Date.now() - range * 60000).toISOString());
                }}
              >
                {s.name} ({s.sensorId})
              </button>
            ))}
          </div>
        </Panel>
      ) : (
        <>
          <State q={history} />
          <State q={latest} />

          {detail.data && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <Badge value={detail.data.data.healthStatus} />
              <Badge value={detail.data.data.status} />
              <span style={{ color: 'var(--muted)', fontSize: '13px' }}>
                {detail.data.data.name} · Type: {detail.data.data.type}
              </span>
            </div>
          )}

          <Panel title="Latest reading">
            <strong className="reading">
              {latest.data?.data ? `${latest.data.data.value} ${currentUnit || ''}` : 'No reading available'}
            </strong>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
              Recorded: {date(latest.data?.data?.timestamp)}
            </p>
          </Panel>

          <Panel title="Telemetry measurements over time">
            {history.data?.data.length ? (
              <Suspense fallback={<p>Loading chart…</p>}>
                <Chart
                  readings={history.data.data}
                  thresholds={thresholds || detail.data?.data.thresholds}
                  format={date}
                  unit={currentUnit}
                />
              </Suspense>
            ) : (
              <p>No telemetry readings recorded in this window.</p>
            )}
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: 10 }}>
              Window starts at {date(windowStart)}. Bounded to 200 readings maximum. Polling does not stream unlimited Time Series data.
            </p>
          </Panel>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Sensor ID</th>
                  <th>Measurement Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.data.map((r, i) => (
                  <tr key={i}>
                    <td>{date(r.timestamp)}</td>
                    <td>{r.metadata.sensorId}</td>
                    <td>{r.metadata.type}</td>
                    <td>
                      <b>
                        {r.value} {r.unit || currentUnit || ''}
                      </b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function Incidents() {
  const role = useAuth()?.role;
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState({
    status: sp.get('status') || '',
    severity: '',
    sensorId: sp.get('sensorId') || '',
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');

  const q = useApi<List<Incident>>('alerts?' + params({ ...filters, page, limit: 20 }));
  const detail = useApi<{ data: Incident }>('alerts/' + encodeURIComponent(selected), !!selected);
  const date = useDate();
  const qc = useQueryClient();

  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: string }) =>
      api('alerts/' + encodeURIComponent(id) + '/' + verb, undefined, 'PATCH', {
        acknowledgedBy: 'local-operator',
        resolvedBy: 'local-operator',
        resolutionNotes: 'Resolved from SensorGuard dashboard',
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['api'] }),
  });

  return (
    <>
      <h1>Incident center</h1>
      <p className="subtitle">Review active anomaly detections, manage response workflows, and inspect audit logs.</p>

      <form
        className="filters"
        onSubmit={e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setFilters({
            status: String(f.get('status') || ''),
            severity: String(f.get('severity') || ''),
            sensorId: String(f.get('sensorId') || ''),
          });
          setPage(1);
        }}
      >
        <select name="status" aria-label="Incident status" defaultValue={filters.status}>
          <option value="">All lifecycle states</option>
          {['open', 'acknowledged', 'resolved'].map(v => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select name="severity" aria-label="Severity" defaultValue={filters.severity}>
          <option value="">All severities</option>
          {['low', 'medium', 'high', 'critical'].map(v => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          name="sensorId"
          aria-label="Incident sensor ID"
          defaultValue={filters.sensorId}
          placeholder="Filter by sensor ID"
          maxLength={150}
        />
        <button type="submit">Apply filters</button>
      </form>

      <State q={q} />

      {action.error && (
        <div role="alert" className="error">
          <span>{action.error.message} — refreshed current state; please review before retrying.</span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Incident</th>
              <th>Sensor</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Triggered</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.data.map(i => (
              <tr key={i.alertId}>
                <td>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--accent)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    onClick={() => setSelected(i.alertId)}
                  >
                    {i.title}
                  </button>
                  <small>
                    {i.type} · {i.alertId}
                  </small>
                </td>
                <td>
                  <Link to={'/sensors/' + encodeURIComponent(i.sensorId)}>{i.sensorId}</Link>
                </td>
                <td>
                  <Badge value={i.severity} />
                </td>
                <td>
                  <Badge value={i.status} />
                </td>
                <td>{date(i.createdAt)}</td>
                <td>
                  {['acknowledge', 'resolve'].map(verb => (
                    <button
                      key={verb}
                      disabled={
                        !role || role === 'VIEWER' || action.isPending ||
                        i.status === 'resolved' ||
                        (verb === 'acknowledge' && i.status !== 'open')
                      }
                      onClick={() => {
                        if (window.confirm(`${verb.toUpperCase()} incident ${i.alertId}?`)) {
                          action.mutate({ id: i.alertId, verb });
                        }
                      }}
                    >
                      {verb}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.data.length === 0 && (
          <p style={{ padding: 16, margin: 0, color: 'var(--muted)' }}>No incidents match these filters.</p>
        )}
      </div>

      <Pages page={page} setPage={setPage} data={q.data?.pagination} />

      {selected && (
        <Panel title="Incident audit details">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3>{selected}</h3>
            <button onClick={() => setSelected('')}>Close details</button>
          </div>
          <State q={detail} />
          {detail.data && (
            <>
              <h3>{detail.data.data.title}</h3>
              <p className="wrap">
                <b>Sensor:</b> {detail.data.data.sensorId} · <b>Incident ID:</b> {detail.data.data.alertId}
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Badge value={detail.data.data.severity} />
                <Badge value={detail.data.data.status} />
              </div>
              <p>
                <b>Acknowledged:</b> {date(detail.data.data.acknowledgedAt)} · {detail.data.data.acknowledgedBy || '—'}
              </p>
              <p>
                <b>Resolved:</b> {date(detail.data.data.resolvedAt)} · {detail.data.data.resolvedBy || '—'}
              </p>
              {detail.data.data.resolutionNotes && (
                <p>
                  <b>Resolution notes:</b> {detail.data.data.resolutionNotes}
                </p>
              )}
              <p className="wrap">
                <b>Recovery event:</b> {detail.data.data.recoveryEventId || 'Automatic recovery pending or not linked'}
              </p>
              <h4>Transition history trail</h4>
              <ol style={{ paddingLeft: 20 }}>
                {detail.data.data.history?.map((h, n) => (
                  <li key={n} style={{ margin: '6px 0' }}>
                    <b>{h.action}</b> · {date(h.at)} · {h.by || h.reason || 'system automatic'}
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>
      )}
    </>
  );
}

export function Analytics() {
  const sensors = useApi<Stats>('sensors/stats');
  const alerts = useApi<Stats>('alerts/stats');

  return (
    <>
      <h1>Network analytics</h1>
      <p className="subtitle">Current aggregate counts from live backend APIs · no fabricated data.</p>
      <State q={sensors} />
      <State q={alerts} />

      <div className="columns">
        <Panel title="Sensors by measurement type">
          <Suspense fallback={<p>Loading chart…</p>}>
            <Distribution values={sensors.data?.data.byType || {}} />
          </Suspense>
        </Panel>

        <Panel title="Sensor health distribution (Heartbeat)">
          <Suspense fallback={<p>Loading chart…</p>}>
            <Distribution values={sensors.data?.data.byHealth || {}} />
          </Suspense>
        </Panel>

        <Panel title="Operational administrative status">
          <Suspense fallback={<p>Loading chart…</p>}>
            <Distribution values={sensors.data?.data.byStatus || {}} />
          </Suspense>
        </Panel>

        <Panel title="Incident severity distribution">
          <Suspense fallback={<p>Loading chart…</p>}>
            <Distribution values={alerts.data?.data.bySeverity || {}} />
          </Suspense>
        </Panel>

        <Panel title="Incident lifecycle counts">
          <Suspense fallback={<p>Loading chart…</p>}>
            <Distribution values={alerts.data?.data.byStatus || {}} />
          </Suspense>
        </Panel>
      </div>

      <Panel title="Historical trends limitation">
        <p>
          The existing backend does not expose time-bucketed aggregation queries for telemetry or incident historical
          trends. These charts present actual live distribution totals rather than fabricated trend series. Downloading
          unbounded Time Series collections to compute client-side trends is intentionally disallowed to protect
          performance.
        </p>
      </Panel>
    </>
  );
}

export function Health() {
  const workers = useApi<{data:{status:string;workers:{id:string;status:string;timestamp?:number}[]}}>('workers');
  const health = useApi<{ status: string; uptime?: number; timestamp?: string }>('health');
  const ready = useApi<{ status: string; services: Record<string, string>; timestamp?: string }>('ready');

  return (
    <>
      <h1>System health & observability</h1>
      <p className="subtitle">Verified live API probes, dependency readiness signals, and observability portals.</p>

      <div className="columns">
        <Panel title="API liveness probe">
          <State q={health} />
          {health.data && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <Badge value={health.data.status} />
                <span>REST API is active and responsive</span>
              </div>
              {health.data.uptime !== undefined && (
                <p>
                  <b>Uptime:</b> {Math.floor(health.data.uptime)} seconds (
                  {(health.data.uptime / 3600).toFixed(2)} hours)
                </p>
              )}
              {health.data.timestamp && (
                <p>
                  <b>Probe timestamp:</b> {new Date(health.data.timestamp).toLocaleString()}
                </p>
              )}
            </>
          )}
        </Panel>

        <Panel title="Dependency readiness probes">
          <State q={ready} />
          {ready.data && (
            <>
              <div style={{ marginBottom: 12 }}>
                <Badge value={ready.data.status} />
              </div>
              {Object.entries(ready.data.services).map(([service, status]) => (
                <div
                  key={service}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{service}</span>
                  <Badge value={status} />
                </div>
              ))}
            </>
          )}
        </Panel>
      </div>

      <Panel title="Telemetry worker heartbeat">
        <State q={workers} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <Badge value={workers.data?.data?.status || 'unavailable'} />
          <span>API readiness does not establish worker health. Heartbeats expire after 30 seconds.</span>
        </div>
        {workers.data?.data?.workers.map(worker => <p key={worker.id}>{worker.id} · {worker.status} · {worker.timestamp ? new Date(worker.timestamp).toLocaleString() : 'Heartbeat expired'}</p>)}
        <p style={{ color: 'var(--muted)', fontSize: '13px' }}>
          API and worker run as decoupled processes. A healthy API confirms Express and dependency connections, but does
          not verify BullMQ queue consumption or background telemetry worker liveness.
        </p>
      </Panel>

      <Panel title="Datadog US5 observability">
        <p style={{ marginBottom: 16 }}>
          Cloud logs, custom metrics, and monitors remain partially unverified without a published dashboard URL.
          The links below direct to the US5 Datadog organization for authenticated operators:
        </p>
        {[
          ['APM Services', 'apm/services'],
          ['Trace Explorer', 'apm/traces'],
          ['Logs Explorer', 'logs'],
        ].map(([label, path]) => (
          <a
            className="external"
            key={path}
            href={'https://us5.datadoghq.com/' + path}
            target="_blank"
            rel="noreferrer"
          >
            {label} ↗
          </a>
        ))}
      </Panel>
    </>
  );
}

export function Settings() {
  const { prefs, setPrefs } = usePrefs();

  return (
    <>
      <h1>Workspace settings</h1>
      <p className="subtitle">Configure local dashboard preferences. All preferences are preserved in browser storage.</p>

      <Panel title="Display & telemetry preferences">
        <div className="editor">
          <label>
            Theme
            <select
              aria-label="Theme"
              value={prefs.theme}
              onChange={e => setPrefs({ ...prefs, theme: e.target.value })}
            >
              <option value="light">Light Theme</option>
              <option value="dark">Dark Theme</option>
            </select>
          </label>

          <label>
            Dashboard Refresh Interval
            <select
              value={prefs.refresh}
              onChange={e => setPrefs({ ...prefs, refresh: Number(e.target.value) })}
            >
              <option value={5000}>5 seconds (Fast)</option>
              <option value={15000}>15 seconds (Standard)</option>
              <option value={30000}>30 seconds (Relaxed)</option>
              <option value={60000}>60 seconds (Conservative)</option>
            </select>
          </label>

          <label>
            Display Timezone
            <select
              value={prefs.timezone}
              onChange={e => setPrefs({ ...prefs, timezone: e.target.value })}
            >
              <option value="local">Browser Local Time</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="Asia/Ho_Chi_Minh">Vietnam (UTC+7)</option>
            </select>
          </label>

          <label>
            Default Chart Time Window
            <select
              value={prefs.range}
              onChange={e => setPrefs({ ...prefs, range: Number(e.target.value) })}
            >
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
              <option value={1440}>24 hours</option>
            </select>
          </label>
        </div>

        <p style={{ marginTop: 16, color: 'var(--muted)', fontSize: '12.5px' }}>
          <b>Security note:</b> This console communicates through a local trusted BFF proxy. No API keys, credentials,
          or secrets are stored in browser localStorage or sessionStorage.
        </p>
      </Panel>
    </>
  );
}
