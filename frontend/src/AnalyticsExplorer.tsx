import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, useApi, useDate, params, Panel, State, type Sensor, type List } from './core';
export type AnalyticsBucket = { timestamp:string;availableAt:string;partial:boolean;min:number;max:number;avg:number;count:number;stdDev:number;movingAverage:number|null;baselineCount:number;baselineStdDev:number|null;ewma:number;ewmaBaseline:number|null;zScore:number|null;ewmaScore:number|null;anomaly:boolean };
export type AnalyticsResult = {data:{sensor:Sensor;series:AnalyticsBucket[];summary:{count:number;min:number|null;max:number|null;avg:number|null;stdDev:number|null;slopePerHour:number|null;trend:string;anomalies:number}};meta:{missingBuckets:number;intervalMs:number;from:string;to:string;baseline:string;scope:string}};
const Chart = lazy(()=>import('./AnalyticsChart'));
const display=(n:number|null|undefined)=>n===null||n===undefined?'—':Number(n.toPrecision(6)).toLocaleString();
export function chartRows(series:AnalyticsBucket[],intervalMs:number) {
  const rows:{time:number;avg:number|null;movingAverage:number|null;ewmaBaseline:number|null;min?:number;max?:number;anomalyValue:number|null}[]=[];
  series.slice(0,1000).forEach((b,i)=>{
    const previous=series[i-1];
    if(previous && Date.parse(b.timestamp)-Date.parse(previous.timestamp)>intervalMs) rows.push({time:Date.parse(previous.availableAt)+1,avg:null,movingAverage:null,ewmaBaseline:null,anomalyValue:null});
    rows.push({time:Date.parse(b.availableAt),avg:b.avg,min:b.min,max:b.max,movingAverage:b.movingAverage,ewmaBaseline:b.ewmaBaseline,anomalyValue:b.anomaly?b.avg:null});
  });return rows;
}
export default function AnalyticsExplorer({fixedSensor}:{fixedSensor?:string}) {
  const date=useDate();
  const sensors=useApi<List<Sensor>>('sensors?limit=100',!fixedSensor);
  const [selection,setSelection]=useState<{sensorId:string;from:string;to:string;granularity:string;window:string;alpha:string}|null>(null);
  const [range,setRange]=useState(60);
  const [formError,setFormError]=useState('');
  const [start,setStart]=useState(()=>new Date(Date.now()-3600000).toISOString().slice(0,16));
  const [end,setEnd]=useState(()=>new Date().toISOString().slice(0,16));
  const query=selection?{...selection,sensorId:fixedSensor||selection.sensorId}:null;
  const path='analytics/series?'+(query?params(query):'');
  const q=useQuery({queryKey:['api',path],queryFn:({signal})=>api<AnalyticsResult>(path,signal),enabled:!!query?.sensorId,refetchInterval:false,refetchOnWindowFocus:false,retry:false,staleTime:30000});
  const series=q.data?.data?.series||[], summary=q.data?.data?.summary;
  return <Panel title="Advanced telemetry analytics">
    <p>Historical snapshot · UTC buckets · statistical markers are not incidents. Apply to refresh the time window.</p>
    <form className="filters" onSubmit={e=>{
      e.preventDefault();setFormError('');const f=new FormData(e.currentTarget);
      try {const from=new Date(start+':00Z').toISOString(),to=new Date(end+':00Z').toISOString();if(from>=to)throw Error('Start must precede end');
        const next={sensorId:fixedSensor||String(f.get('sensorId')||'').trim(),from,to,granularity:String(f.get('granularity')),window:String(f.get('window')),alpha:String(f.get('alpha'))};
        if(JSON.stringify(next)===JSON.stringify(selection))void q.refetch();else setSelection(next);
      }catch{setFormError('Choose a valid UTC start and end time');}
    }}>
      {!fixedSensor&&<label>Analytics sensor ID<input name="sensorId" list="analytics-sensors" required maxLength={100}/><datalist id="analytics-sensors">{sensors.data?.data.map(s=><option key={s.sensorId} value={s.sensorId}>{s.name}</option>)}</datalist></label>}
      {fixedSensor&&<p>Sensor: <b>{fixedSensor}</b></p>}
      <label>Analytics time range<select value={range} onChange={e=>{const n=Number(e.target.value);setRange(n);setStart(new Date(Date.now()-n*60000).toISOString().slice(0,16));setEnd(new Date().toISOString().slice(0,16));}}><option value={60}>Last hour</option><option value={1440}>Last 24 hours</option><option value={10080}>Last 7 days</option></select></label>
      <label>From (UTC)<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>To (UTC, exclusive)<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label>Granularity<select name="granularity" defaultValue="5m">{['1m','5m','15m','1h','1d'].map(g=><option key={g}>{g}</option>)}</select></label>
      <label>Previous buckets<input name="window" type="number" min={3} max={100} defaultValue={12} required/></label>
      <label>EWMA alpha<input name="alpha" type="number" min={0.01} max={1} step={0.01} defaultValue={0.2} required/></label>
      <button className="primary">Apply analytics</button>
    </form>
    {!fixedSensor&&sensors.isError&&<State q={sensors}/>}
    {formError&&<p role="alert">{formError}</p>}
    {!query?<p>Select a sensor and apply a bounded time range.</p>:<State q={q}/>}
    {q.data&&<>
      <p>{q.data.data.sensor.type} · {q.data.data.sensor.unit} · current sensor thresholds (not historical configuration)</p>
      {summary&&<p>Readings: {summary.count} · Min: {display(summary.min)} · Max: {display(summary.max)} · Mean: {display(summary.avg)} · Population σ: {display(summary.stdDev)} · Trend: {summary.trend} ({display(summary.slopePerHour)} {q.data.data.sensor.unit}/hour) · Anomaly buckets: {summary.anomalies}</p>}
      {!series.length?<p>No matching telemetry in this range.</p>:<Suspense fallback={<p role="status">Loading analytics chart…</p>}><Chart result={q.data} format={date}/></Suspense>}
      <p>{q.data.meta.missingBuckets} empty buckets; gaps are not zeros. Baselines use prior observed buckets, excluding the current bucket; scores require 3 prior buckets and nonzero variance. EWMA resets at the selected start. X-axis is the observation cutoff, not the start of its bucket.</p>
      <div className="table-wrap"><table style={{minWidth:1100}}><caption>UTC buckets and causal baselines · {series.length} rows</caption><thead><tr>{['Bucket start','Count','Min','Max','Mean','σ','Prior MA','Prior EWMA','Z-score','EWMA score','Flag'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{series.map(b=><tr key={b.timestamp}><td>{date(b.timestamp)}{b.partial?' (partial)':''}</td><td>{b.count}</td>{[b.min,b.max,b.avg,b.stdDev,b.movingAverage,b.ewmaBaseline,b.zScore,b.ewmaScore].map((n,i)=><td key={i}>{display(n)}</td>)}<td>{b.anomaly?'Anomaly':b.zScore===null?'Insufficient baseline':'Normal'}</td></tr>)}</tbody></table></div>
    </>}
  </Panel>;
}
