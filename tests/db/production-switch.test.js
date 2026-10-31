import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
let db;
beforeAll(async()=>{const u=process.env.TEST_DATABASE_URL;if(!u || !['127.0.0.1','localhost','::1','[::1]'].includes(new URL(u).hostname))throw Error('Disposable localhost database required');await openIsolatedSchema(u);db=createDb(neonShapedQuery());await db.initSchema();});
afterAll(async()=>closeIsolatedSchema());
describe('B-2 durable production switch and revocation',()=>{
  it('defaults enabled (AUD-BD) and permits only a selected account update',async()=>{
    await rawQuery("INSERT INTO vercel_accounts (id,team_id,team_slug,label,scope,token_enc,token_last4) VALUES ('team_FAKE','team_FAKE','fixture','Fixture','team','fake ciphertext','1234')");
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enabled).toBe(true);
    expect(await db.setProductionEnabled('team_UNKNOWN',true)).toBe(false);
    expect(await db.setProductionEnabled('team_FAKE',true)).toBe(true);
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enabled).toBe(true);
  });
  it('disables production and revokes only production connector tokens for selected team',async()=>{
    await rawQuery("INSERT INTO oauth_tokens (token_hash,vercel_account,mode,profile,listing,expires_at) VALUES ('fake_prod','team_FAKE','production','full','compact',now()+interval '1 hour'),('fake_preview','team_FAKE','preview','full','compact',now()+interval '1 hour'),('fake_other','team_OTHER','production','full','compact',now()+interval '1 hour')");
    expect(await db.setProductionEnabled('team_FAKE',false)).toBe(true);
    expect(await db.revokeProductionTokens('team_FAKE')).toBe(1);
    const rows=await rawQuery('SELECT token_hash,revoked_at FROM oauth_tokens ORDER BY token_hash');
    expect(rows.find(x=>x.token_hash==='fake_prod').revoked_at).not.toBeNull();
    expect(rows.find(x=>x.token_hash==='fake_preview').revoked_at).toBeNull();
    expect(rows.find(x=>x.token_hash==='fake_other').revoked_at).toBeNull();
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enabled).toBe(false);
  });
  it('AUD-B: strictness defaults to word on a fresh account',async()=>{
    expect((await rawQuery("SELECT production_enable_strictness FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enable_strictness).toBe('word');
    expect(await db.getProductionEnableStrictness('team_FAKE')).toBe('word');
    expect(await db.getProductionEnableStrictness('team_UNKNOWN')).toBeNull();
  });
  it('AUD-B: setProductionEnableStrictness round-trips and journals every successful set',async()=>{
    expect(await db.setProductionEnableStrictness('team_FAKE','passphrase')).toBe(true);
    expect(await db.getProductionEnableStrictness('team_FAKE')).toBe('passphrase');
    expect((await rawQuery("SELECT production_enable_strictness FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enable_strictness).toBe('passphrase');
    expect(await db.setProductionEnableStrictness('team_FAKE','word')).toBe(true);
    expect(await db.getProductionEnableStrictness('team_FAKE')).toBe('word');
    const logs=await rawQuery("SELECT vercel_account,tool,summary,after,dry_run,production FROM change_log WHERE tool='vercel_enable_production' AND summary LIKE 'Owner set the production enable strictness%' ORDER BY id");
    expect(logs).toHaveLength(2);
    expect(logs[0].summary).toContain('passphrase');
    expect(logs[0].after).toEqual({strictness:'passphrase'});
    expect(logs[1].summary).toContain('word');
    expect(logs[1].after).toEqual({strictness:'word'});
    expect(logs.every(r=>r.production===true&&r.dry_run===false)).toBe(true);
    // Setting strictness never enables production by itself.
    expect((await rawQuery("SELECT production_enabled FROM vercel_accounts WHERE id='team_FAKE'"))[0].production_enabled).toBe(false);
  });
  it('AUD-B: rejects invalid strictness and missing accounts without journaling',async()=>{
    for(const invalid of ['ceremony','WORD','',null,undefined,true,0]){
      await expect(db.setProductionEnableStrictness('team_FAKE',invalid)).rejects.toThrow();
    }
    await expect(db.setProductionEnableStrictness('bad name','word')).rejects.toThrow();
    await expect(db.getProductionEnableStrictness('bad name')).rejects.toThrow();
    expect(await db.setProductionEnableStrictness('team_UNKNOWN','word')).toBe(false);
    const logs=await rawQuery("SELECT id FROM change_log WHERE tool='vercel_enable_production' AND summary LIKE 'Owner set the production enable strictness%'");
    expect(logs).toHaveLength(2);
    expect(await db.getProductionEnableStrictness('team_FAKE')).toBe('word');
  });
});
