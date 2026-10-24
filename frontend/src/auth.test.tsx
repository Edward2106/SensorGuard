import React from 'react';
import { describe,it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { AuthGate,AuthContext,Users } from './auth';
const response=(status:number,data:unknown)=>Promise.resolve({ok:status===200,status,json:async()=>data});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const mount=(node:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{node}</QueryClientProvider>);
describe('authentication UI',()=>{
 it('blocks content until authentication and never stores password',async()=>{vi.stubGlobal('fetch',vi.fn((p:string)=>p.endsWith('/login')?response(200,{data:{id:'x',username:'alice',role:'VIEWER'}}):response(401,{message:'Authentication required'})));mount(<AuthGate><h1>Private dashboard</h1></AuthGate>);await screen.findByText('Sign in');expect(screen.queryByText('Private dashboard')).toBeNull();fireEvent.change(screen.getByLabelText('Username'),{target:{value:'alice'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'not-stored-password'}});fireEvent.click(screen.getByText('Sign in'));await screen.findByText('Private dashboard');expect(JSON.stringify(localStorage)).not.toContain('not-stored-password');});
 it('shows clear invalid login errors',async()=>{vi.stubGlobal('fetch',vi.fn(()=>response(401,{message:'Invalid username or password'})));mount(<AuthGate><div>Private</div></AuthGate>);await screen.findByText('Sign in');fireEvent.change(screen.getByLabelText('Username'),{target:{value:'alice'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'wrong'}});fireEvent.click(screen.getByText('Sign in'));await screen.findByRole('alert');expect(screen.queryByText('Private')).toBeNull();});
 it('viewer cannot open admin users page',()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);mount(<AuthContext.Provider value={{id:'v',username:'viewer',role:'VIEWER',disabled:false}}><Users/></AuthContext.Provider>);expect(screen.getByText('Administrator permission required')).toBeTruthy();expect(fetcher).not.toHaveBeenCalled();});
});
