import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './core';
export type User = { id:string; username:string; role:'ADMIN'|'OPERATOR'|'VIEWER'; disabled:boolean };
export const AuthContext = createContext<User|null>(null);
export const useAuth = () => useContext(AuthContext);
export function AuthGate({ children }: { children:ReactNode }) {
  const client = useQueryClient();
  const session = useQuery({queryKey:['session'],queryFn:({signal})=>api<{data:User}>('auth/me',signal),retry:false,refetchInterval:60000});
  const [username,setUsername] = useState(''), [password,setPassword] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(()=>{const expired=()=>{client.clear();void session.refetch();};window.addEventListener('sg:expired',expired);return()=>window.removeEventListener('sg:expired',expired);},[client,session.refetch]);
  if (session.isPending) return <main className="login"><p role="status">Checking session…</p></main>;
  if (session.data && !session.isError) return <AuthContext.Provider value={session.data.data}>{children}</AuthContext.Provider>;
  return <main className="login"><section className="panel"><h1>SensorGuard</h1><p>Sign in to the operations console.</p><form onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError('');
    try {const result=await api<{data:User}>('auth/login',undefined,'POST',{username,password});setPassword('');client.clear();client.setQueryData(['session'],result);}
    catch(e){setError((e as Error).message);setPassword('');}finally{setBusy(false);}
  }}><label>Username<input autoComplete="username" required maxLength={64} value={username} onChange={e=>setUsername(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} /></label><button className="primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>{error&&<p role="alert">{error}</p>}{session.error&&<p role="status">{session.error.message}</p>}<p>Ask an administrator for access. No public registration.</p></section></main>;
}
export function Account() {
  const user=useAuth(), client=useQueryClient();const [error,setError]=useState('');
  return <div><span>{user?.username} · {user?.role}</span> <button onClick={async()=>{try{await api('auth/logout',undefined,'POST');client.clear();window.location.assign('/');}catch(e){setError((e as Error).message);}}}>Sign out</button>{error&&<span role="alert">{error}</span>}</div>;
}
export function Users() {
  const current=useAuth(), client=useQueryClient();const [page,setPage]=useState(1), [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const users=useQuery({queryKey:['users',page],queryFn:()=>api<{data:User[]}>('auth/users?page='+page),enabled:current?.role==='ADMIN'});
  if(current?.role!=='ADMIN')return <h1>Administrator permission required</h1>;
  const update=async(id:string,body:unknown)=>{if(!window.confirm('Change this account and invalidate its sessions?'))return;setBusy(true);try{await api('auth/users/'+id,undefined,'PATCH',body);await client.invalidateQueries({queryKey:['users']});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <><h1>User accounts</h1><p>Role changes and disabling an account invalidate all its sessions.</p>{error&&<p role="alert">{error}</p>}
    <form className="panel filters" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget, values=new FormData(form);setBusy(true);setError('');try{await api('auth/users',undefined,'POST',Object.fromEntries(values));form.reset();await client.invalidateQueries({queryKey:['users']});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label>New username<input name="username" required pattern="[a-z0-9][a-z0-9._-]{2,63}" autoComplete="off"/></label><label>Initial password<input name="password" type="password" required minLength={16} maxLength={256} autoComplete="new-password"/></label><label>Role<select name="role"><option>VIEWER</option><option>OPERATOR</option><option>ADMIN</option></select></label><button disabled={busy}>Create account</button>
    </form>{users.isPending&&<p role="status">Loading users…</p>}{users.error&&<p role="alert">{users.error.message}</p>}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.data?.data.map(user=><tr key={user.id}><td>{user.username}</td><td><select aria-label={'Role for '+user.username} value={user.role} disabled={busy||user.id===current.id} onChange={e=>void update(user.id,{role:e.target.value})}>{['VIEWER','OPERATOR','ADMIN'].map(role=><option key={role}>{role}</option>)}</select></td><td>{user.disabled?'Disabled':'Enabled'}</td><td><button disabled={busy||user.id===current.id} onClick={()=>void update(user.id,{disabled:!user.disabled})}>{user.disabled?'Enable':'Disable'}</button></td></tr>)}</tbody></table></div><button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span> Page {page} </span><button disabled={!users.data||users.data.data.length<50} onClick={()=>setPage(page+1)}>Next</button></section></>;
}
