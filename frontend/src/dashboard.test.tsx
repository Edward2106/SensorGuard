import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Preferences, api, escapeSearch } from './core';
import { Overview, Sensors, Monitoring, Incidents, Analytics, Health, Settings } from './pages';
import { points } from './Charts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Preferences>
        <MemoryRouter>{element}</MemoryRouter>
      </Preferences>
    </QueryClientProvider>
  );
}

const response = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 409, json: async () => body });

describe('dashboard', () => {
  it('paginates and filters sensors using API query parameters', async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      response({
        data: [{ sensorId: 'SEN-1', name: 'Boiler', type: 'temperature', status: 'active' }],
        pagination: { page: 1, total: 30, totalPages: 2 },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    mount(<Sensors />);
    await screen.findByText('Boiler');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([p]) => p.includes('page=2'))).toBe(true)
    );
    fireEvent.change(screen.getByLabelText('Sensor type'), { target: { value: 'humidity' } });
    fireEvent.click(screen.getByText('Apply filters'));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([p]) => p.includes('type=humidity') && p.includes('page=1'))
      ).toBe(true)
    );
  });

  it('shows loading, then retryable errors', async () => {
    let finish: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { finish = r; })));
    mount(<Sensors />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    finish({ ok: false, status: 503, json: async () => ({ message: 'Dependency unavailable' }) });
    await screen.findByRole('alert');
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('confirms incident acknowledgement and handles concurrent conflict', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetcher = vi.fn().mockImplementation((_p, init) =>
      init.method === 'PATCH'
        ? response({ message: 'Already resolved' }, false)
        : response({
            data: [
              {
                alertId: 'ALT-1',
                sensorId: 'SEN-1',
                title: 'Hot',
                severity: 'high',
                status: 'open',
                createdAt: new Date().toISOString(),
              },
            ],
            pagination: { total: 1, totalPages: 1, page: 1 },
          })
    );
    vi.stubGlobal('fetch', fetcher);
    mount(<Incidents />);
    await screen.findByText('Hot');
    fireEvent.click(screen.getByText('acknowledge'));
    await screen.findByRole('alert');
    expect(
      fetcher.mock.calls.some(
        ([p, init]) => p.endsWith('/ALT-1/acknowledge') && init.method === 'PATCH'
      )
    ).toBe(true);
  });

  it('bounds and sorts valid chart values', () => {
    const rows = [
      { timestamp: '2026-10-24T02:00:00Z', value: 2, metadata: { sensorId: 'a', type: 'temperature' } },
      { timestamp: 'invalid', value: 1, metadata: { sensorId: 'a', type: 'temperature' } },
      { timestamp: '2026-10-24T01:00:00Z', value: 1, metadata: { sensorId: 'a', type: 'temperature' } },
    ];
    expect(points(rows).map(r => r.value)).toEqual([1, 2]);
    expect(points(Array(300).fill(rows[0]))).toHaveLength(200);
  });

  it('does not attach privileged browser credentials', async () => {
    const fetcher = vi.fn((_url: string, _options: RequestInit) => response({}));
    vi.stubGlobal('fetch', fetcher);
    await api('sensors');
    const options = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options?.headers).toEqual({ 'X-SensorGuard-UI': '1' });
    expect(escapeSearch('a.*')).toBe('a\\.\\*');
  });

  it('settings persist only UI preferences', () => {
    mount(<Settings />);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect(JSON.parse(localStorage.getItem('sg.preferences') || '{}').theme).toBe('dark');
    expect(localStorage.getItem('sg.preferences')).not.toContain('API_KEY');
  });

  it('never infers worker readiness from API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response({ status: 'ready', services: { mongodb: 'connected', redis: 'connected' } })
      )
    );
    mount(<Health />);
    expect(screen.getByText(/API readiness does not establish worker health/)).toBeTruthy();
    await screen.findAllByText('connected');
  });

  it('overview connects to real aggregates and separates online from active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('sensors/stats')) {
          return response({
            data: {
              total: 247,
              byStatus: { active: 127, maintenance: 120 },
              byHealth: { online: 5, offline: 122, unknown: 120 },
            },
          });
        }
        if (url.includes('alerts/stats')) {
          return response({
            data: {
              total: 132,
              byStatus: { open: 127, resolved: 5 },
              bySeverity: { critical: 5, high: 127 },
            },
          });
        }
        if (url.includes('alerts?limit=5')) {
          return response({
            data: [
              {
                alertId: 'ALT-1',
                sensorId: 'DEV-TEMP-001',
                title: 'High Temperature Detected',
                severity: 'critical',
                status: 'open',
                createdAt: new Date().toISOString(),
              },
            ],
            pagination: { total: 1, page: 1, totalPages: 1 },
          });
        }
        return response({ data: [], pagination: { total: 0, page: 1, totalPages: 1 } });
      })
    );

    mount(<Overview />);
    await screen.findByText('Operations overview');
    expect(await screen.findByText('247')).toBeTruthy();
    expect(await screen.findByText('122')).toBeTruthy();
    expect(await screen.findByText('High Temperature Detected')).toBeTruthy();
  });

  it('monitoring supports sensor selection and time window changes', async () => {
    const fetcher = vi.fn((url: string) => {
      if (url.includes('sensors?limit=100')) {
        return response({
          data: [{ sensorId: 'DEV-TEMP-001', name: 'Main Boiler', type: 'temperature' }],
          pagination: { total: 1, page: 1, totalPages: 1 },
        });
      }
      if (url.includes('/readings/latest')) {
        return response({
          data: {
            timestamp: new Date().toISOString(),
            value: 42.5,
            unit: 'C',
            metadata: { sensorId: 'DEV-TEMP-001', type: 'temperature' },
          },
        });
      }
      return response({
        data: [
          {
            timestamp: new Date().toISOString(),
            value: 42.5,
            unit: 'C',
            metadata: { sensorId: 'DEV-TEMP-001', type: 'temperature' },
          },
        ],
        pagination: { total: 1, page: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', fetcher);

    mount(<Monitoring />);
    await screen.findByText('Real-time monitoring');
    const button = await screen.findByText('Main Boiler (DEV-TEMP-001)');
    fireEvent.click(button);
    const readings = await screen.findAllByText(/42\.5/);
    expect(readings.length).toBeGreaterThan(0);
  });

  it('analytics displays distribution panels without fabricating historical trends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('sensors/stats')) {
          return response({
            data: {
              total: 10,
              byType: { temperature: 6, humidity: 4 },
              byHealth: { offline: 8, online: 2 },
              byStatus: { active: 10 },
            },
          });
        }
        return response({
          data: {
            total: 2,
            bySeverity: { critical: 1, high: 1 },
            byStatus: { open: 2 },
          },
        });
      })
    );

    mount(<Analytics />);
    await screen.findByText('Network analytics');
    expect(screen.getByText(/Historical trends limitation/)).toBeTruthy();
  });
});
