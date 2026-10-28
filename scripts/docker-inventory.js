// Read-only inventory: never persists container environment variables or credentials.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
const lines = value => value ? value.split('\n').map(line => JSON.parse(line)) : [];
const ids = docker(['ps', '-aq']).split(/\s+/).filter(Boolean);
const stats = lines(docker(['stats', '--no-stream', '--format', '{{json .}}']));
const containers = ids.length ? JSON.parse(docker(['inspect', ...ids])).map(c => {
  const name = c.Name.slice(1), project = c.Config.Labels?.['com.docker.compose.project'] || null;
  const staging = project === 'sensorguard-phase8-staging';
  return { name, id: c.Id, project, image: c.Config.Image, imageId: c.Image,
    status: c.State.Status, health: c.State.Health?.Status || 'not-configured',
    resources: stats.find(s => s.ID === c.Id.slice(0, 12)) || null,
    ports: c.NetworkSettings.Ports, mounts: c.Mounts.map(m => ({ type: m.Type, name: m.Name, source: m.Source, destination: m.Destination, rw: m.RW })),
    networks: Object.keys(c.NetworkSettings.Networks),
    dependencies: c.Config.Labels?.['com.docker.compose.depends_on'] || null,
    lastUsedEvidence: { startedAt: c.State.StartedAt, finishedAt: c.State.FinishedAt, note: 'Lifecycle timestamps alone do not establish inactivity' },
    recommendation: staging ? 'KEEP' : 'REVIEW',
  };
}) : [];
const report = { recordedAt: new Date(), server: docker(['version', '--format', '{{.Server.Version}}']), containers,
  images: lines(docker(['image', 'ls', '--format', '{{json .}}'])),
  volumes: lines(docker(['volume', 'ls', '--format', '{{json .}}'])),
  networks: lines(docker(['network', 'ls', '--format', '{{json .}}'])),
  projects: JSON.parse(docker(['compose', 'ls', '--format', 'json'])) };
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ containers: containers.map(({name,status,health,recommendation}) => ({name,status,health,recommendation})), output }));
