import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { chartRows, type AnalyticsResult } from './AnalyticsExplorer';
export default function AnalyticsChart({result,format}:{result:AnalyticsResult;format:(value:string)=>string}) {
  const rows=chartRows(result.data.series,result.meta.intervalMs);
  return <div role="img" aria-label="Bucket measurements, prior moving average, prior EWMA and anomaly markers; values are in the table below">
    <ResponsiveContainer width="100%" height={360}><LineChart data={rows} margin={{top:15,right:25,left:5,bottom:10}}>
      <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" type="number" domain={['dataMin','dataMax']} tickFormatter={n=>format(new Date(n).toISOString())} minTickGap={100}/><YAxis domain={['auto','auto']} unit={' '+result.data.sensor.unit}/>
      <Tooltip labelFormatter={n=>format(new Date(Number(n)).toISOString())}/><Legend/>
      <Line dataKey="avg" name="Bucket mean" stroke="#10b981" dot={false} connectNulls={false} isAnimationActive={false}/>
      <Line dataKey="min" name="Minimum" stroke="#94a3b8" strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false}/>
      <Line dataKey="max" name="Maximum" stroke="#64748b" strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false}/>
      <Line dataKey="movingAverage" name="Prior moving average" stroke="#3b82f6" dot={false} connectNulls={false} isAnimationActive={false}/>
      <Line dataKey="ewmaBaseline" name="Prior EWMA" stroke="#a855f7" dot={false} connectNulls={false} isAnimationActive={false}/>
      <Line dataKey="anomalyValue" name="Statistical anomaly" stroke="none" dot={{r:5,fill:'#ef4444',stroke:'#ef4444'}} connectNulls={false} isAnimationActive={false}/>
      {['warningHigh','warningLow','criticalHigh','criticalLow'].map(key=><Line key={key} dataKey={key} name={'Historical '+key} type="stepAfter" stroke={key.startsWith('critical')?'#ef4444':'#f59e0b'} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false}/>)}
    </LineChart></ResponsiveContainer>
  </div>;
}
