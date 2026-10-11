import {describe,it,expect,vi} from 'vitest';
import {visibleToProfile,listProfileTools} from '../../src/core/profiles.js';
import {readProvider,writeProvider,transportReplayKey} from '../../src/vercel/provider.js';
import {loadToken} from '../../src/vercel/tokens.js';
vi.mock('../../src/vercel/tokens.js',async original=>({...await original(),loadToken:vi.fn()}));
const connection={account:'acct_FAKE_TEAM',profile:'everyday',mode:'preview'};
const token={token:'vcp_FAKE_write',account:{id:connection.account,team_id:'team_FAKE',scope:'team'}};
const db={getAccountCredential:async()=>({}),requestReplayStore:()=>({claim:async()=>({state:'claimed',claimId:'fake'}),complete:async()=>{}})};
describe('D-1 fail-closed provider write gateway',()=>{
  it('keeps routine writes hidden without an explicit fully declared contract',()=>{
    const base={name:'vercel_test',writes:true,profiles:['everyday','full'],guardedWrite:true};
    for(const profile of ['read_only','everyday','full']){
      expect(visibleToProfile({...base,writeContract:{}},profile)).toBe(false);
      expect(visibleToProfile({...base,writeContract:{production:true,targets:true}},profile))
        .toBe(profile!=='read_only');
    }
    expect(visibleToProfile({...base,guardedWrite:false,writeContract:{production:true,targets:true}},'full')).toBe(false);
    expect(visibleToProfile({...base,localAdmin:true,writeContract:{production:true,targets:true}},'everyday')).toBe(false);
    const items=listProfileTools({tools:[{...base,writeContract:{production:true,targets:true}}]},'everyday');
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('guardedWrite');
    expect(items[0]).not.toHaveProperty('writeContract');
  });
  it('uses a stable separate transport claim without exposing the logical key',()=>{
    const key='rmcp_FAKE_logical_request';
    expect(transportReplayKey(key)).toMatch(/^transport_[a-f0-9]{64}$/);
    expect(transportReplayKey(key)).toBe(transportReplayKey(key));
    expect(transportReplayKey(key)).not.toContain(key);
    for(const bad of ['', 'too', '../../unsafe'])expect(()=>transportReplayKey(bad)).toThrow();
  });
  it('refuses missing replay durability before an HTTP call',async()=>{
    loadToken.mockResolvedValue(token);
    await expect(writeProvider({db:{...db,requestReplayStore:undefined},connection}))
      .rejects.toThrow(/Durable transport/);
  });
  it('separates read-only binding and rejects write profiles before provider mutation',async()=>{
    loadToken.mockResolvedValue(token);
    const read=await readProvider({db,connection});
    expect(read.account.id).toBe(connection.account);
    await expect(writeProvider({db,connection:{...connection,profile:'read_only'}}))
      .rejects.toThrow(/write-capable/);
    const writer=await writeProvider({db,connection});
    expect(()=>writer.read('projects_create',{})).toThrow(/Read-back/);
    expect(()=>writer.write('projects_list',{},{
      requestKey:'rmcp_FAKE_key',tool:'vercel_test',shapeResult:x=>x
    })).toThrow(/Guarded mutation/);
    expect(()=>writer.write('projects_create',{},{
      requestKey:'bad',tool:'vercel_test',shapeResult:x=>x
    })).toThrow(/logical replay/);
  });
});
