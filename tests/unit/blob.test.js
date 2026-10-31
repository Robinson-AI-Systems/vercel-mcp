import {describe,it,expect,vi,beforeEach} from 'vitest';
import {makeFakeVercel} from '../../test/helpers/fake-vercel.js';
import {blobReadTools,blobWriteTools} from '../../src/tools/blob.js';
import {encryptSecret} from '../../src/core/secret-box.js';
import {BLOB_CONTEXT} from '../../src/vercel/blob.js';
import {loadToken} from '../../src/vercel/tokens.js';
import {list as sdkList,head as sdkHead,put as sdkPut,del as sdkDel}
  from '@vercel/blob';
vi.mock('../../src/vercel/tokens.js',async m=>({...await m(),loadToken:vi.fn()}));
vi.mock('@vercel/blob',()=>({list:vi.fn(),head:vi.fn(),put:vi.fn(),del:vi.fn()}));

const env={TOKEN_ENCRYPTION_KEY:'00'.repeat(32),VERCEL_ENV:'production',
  ADMIN_PASSPHRASE:'fixture-owner-passphrase'};
const account={id:'acct_1',team_id:'team_SEAT',scope:'team'};
const TOKEN='vercel_blob_rw_FAKE_plantedTokenValue9876';
const STORE='store_FAKE1';
const sdkError=name=>Object.assign(new Error(name),{name});
const blobMeta=(pathname,size)=>({pathname,size,url:'https://x/'+pathname,
  downloadUrl:'https://x/'+pathname+'?download=1',
  uploadedAt:new Date('2026-10-01T00:00:00.000Z'),etag:'etag1',
  contentType:'text/plain',contentDisposition:'inline',cacheControl:'public'});

function fixture(){
  const api=makeFakeVercel(),rows=new Map(),audit=[];
  const connections=new Map();
  const db={
    getAccountCredential:async()=>({}),listProtectedResources:async()=>[],
    recordChange:async row=>audit.push(row),
    getPurchasePolicy:async()=>({grantRequired:false,budgetCents:null}),
    getTodaySpendCents:async()=>0,
    requestReplayStore:()=>({
      claim:async({key})=>{
        if(rows.has(key))return rows.get(key);
        rows.set(key,{state:'pending'});return {state:'claimed',claimId:'FAKE'};
      },
      complete:async({key,result})=>rows.set(key,{state:'completed',result}),
      release:async({key})=>rows.delete(key)
    }),
    insertBlobStoreConnection:async({account:a,storeId,label,access,
      ciphertext,tokenLast4})=>{
      connections.set(a+':'+storeId,{account:a,storeId,label,access,
        tokenLast4,ciphertext,createdAt:new Date(),updatedAt:new Date()});
    },
    listBlobStoreConnections:async(a)=>[...connections.values()]
      .filter(r=>!a||r.account===a)
      .map(({ciphertext:_c,...safe})=>safe),
    getBlobStoreConnectionCiphertext:async({account:a,storeId})=>
      connections.get(a+':'+storeId)?.ciphertext??null,
    deleteBlobStoreConnection:async({account:a,storeId})=>
      connections.delete(a+':'+storeId)
  };
  const connect=async(storeId=STORE,access='public')=>
    db.insertBlobStoreConnection({account:account.id,storeId,label:'Uploads',
      access,tokenLast4:TOKEN.slice(-4),
      ciphertext:encryptSecret(TOKEN,BLOB_CONTEXT(account.id,storeId),env)});
  const ctx=(connection)=>({db,connection,env,fetchImpl:api.fetch});
  const full={account:account.id,profile:'full',mode:'production',
    listing:'catalog',kind:'connector'};
  const preview={...full,mode:'preview'};
  return {api,db,audit,rows,connections,connect,full,preview,
    list:(args,c=full)=>blobReadTools.handlers.vercel_blob_list(args,ctx(c)),
    head:(args,c=full)=>blobReadTools.handlers.vercel_blob_head(args,ctx(c)),
    put:(args,c=full)=>blobWriteTools.handlers.vercel_blob_put(args,ctx(c)),
    del:(args,c=full)=>blobWriteTools.handlers.vercel_blob_delete(args,ctx(c))};
}
const read=r=>JSON.parse(r.content[0].text);
const b64=s=>Buffer.from(s).toString('base64');
function storeProjects(api,environments){
  api.when('GET','/storage/stores/{id}').resolves({store:{status:'ready',
    usageQuotaExceeded:false,
    projectsMetadata:environments?[{projectId:'prj_FAKE1',
      environments}]:[]}});
}
describe('M-4 blob tools',()=>{
 beforeEach(()=>{vi.clearAllMocks();
   loadToken.mockResolvedValue({token:'vcp_FAKE',account});});

 it('answers an unconnected store with the setup steps, not a refusal',async()=>{
   const f=fixture();
   const r=read(await f.list({store:STORE}));
   expect(r.connected).toBe(false);
   expect(r.message).toMatch(/enrollment step of the sign-in flow/);
   expect(sdkList).not.toHaveBeenCalled();
 });
 it('lists folded by default, follows the cursor, and states truncation at the limit',async()=>{
   const f=fixture(); await f.connect();
   sdkList.mockResolvedValueOnce({blobs:[blobMeta('a.txt',3)],
     folders:['docs/'],cursor:'c1',hasMore:true})
     .mockResolvedValueOnce({blobs:[blobMeta('b.txt',4)],
       folders:['docs/'],hasMore:false});
   const r=read(await f.list({store:STORE,limit:10}));
   expect(r).toMatchObject({connected:true,mode:'folded',shown:2,
     folders:['docs/'],truncated:false});
   expect(sdkList.mock.calls[0][0]).toMatchObject({token:TOKEN,mode:'folded'});
   expect(sdkList.mock.calls[1][0].cursor).toBe('c1');
   sdkList.mockResolvedValue({blobs:[blobMeta('a.txt',3)],
     cursor:'c9',hasMore:true});
   const t=read(await f.list({store:STORE,limit:1}));
   expect(t.truncated).toBe(true);
   expect(t.note).toMatch(/More files exist/);
 });
 it('heads a file, and answers found:false for a missing one',async()=>{
   const f=fixture(); await f.connect();
   sdkHead.mockResolvedValueOnce(blobMeta('a.txt',3));
   const r=read(await f.head({store:STORE,pathname:'a.txt'}));
   expect(r).toMatchObject({found:true,file:{size:3,
     contentType:'text/plain',cacheControl:'public'}});
   sdkHead.mockRejectedValueOnce(sdkError('BlobNotFoundError'));
   const missing=read(await f.head({store:STORE,pathname:'nope.txt'}));
   expect(missing).toMatchObject({found:false,pathname:'nope.txt'});
 });
 it('put previews, refuses overwrite without the flag, then applies and verifies — token never surfaces',async()=>{
   const f=fixture(); await f.connect(); storeProjects(f.api,['preview']);
   sdkHead.mockRejectedValue(sdkError('BlobNotFoundError'));
   const plan=read(await f.put({store:STORE,pathname:'hello.txt',
     contentBase64:b64('hello')}));
   expect(plan.status).toBe('needs_confirmation');
   expect(plan.preview).toMatch(/5 byte\(s\) to hello\.txt/);
   sdkPut.mockResolvedValue({pathname:'hello.txt',url:'https://x/hello.txt',
     contentType:'text/plain'});
   sdkHead.mockReset();
   sdkHead.mockRejectedValueOnce(sdkError('BlobNotFoundError'));
   sdkHead.mockResolvedValue(blobMeta('hello.txt',5));
   const r=read(await f.put({store:STORE,pathname:'hello.txt',
     contentBase64:b64('hello'),confirm:true,requestKey:'blob-put-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true});
   expect(sdkPut.mock.calls[0][2]).toMatchObject({token:TOKEN,
     allowOverwrite:false,addRandomSuffix:false});
   const surfaces=JSON.stringify(r)+JSON.stringify(f.audit)+
     JSON.stringify([...f.rows.values()]);
   expect(surfaces).not.toContain('plantedTokenValue9876');
   // existing file without allowOverwrite refuses in before()
   sdkHead.mockResolvedValue(blobMeta('hello.txt',5));
   const again=read(await f.put({store:STORE,pathname:'hello.txt',
     contentBase64:b64('hello'),confirm:true,requestKey:'blob-put-test-2'}));
   expect(again.status).toBe('refused_by_guard');
   expect(JSON.stringify(again)).toMatch(/allowOverwrite/);
 });
 it('put is production-class on a production-linked store and blocked on a preview connection',async()=>{
   const f=fixture(); await f.connect(); storeProjects(f.api,['production']);
   sdkHead.mockRejectedValue(sdkError('BlobNotFoundError'));
   const r=read(await f.put({store:STORE,pathname:'x.txt',
     contentBase64:b64('x'),confirm:true,requestKey:'blob-put-test-3'},
     f.preview));
   expect(r.status).toBe('refused_by_guard');
   expect(sdkPut).not.toHaveBeenCalled();
 });
 it('delete refuses wildcards and project-connected stores without outsideApp; preview lists sizes',async()=>{
   const f=fixture(); await f.connect(); storeProjects(f.api,['production']);
   const wild=read(await f.del({store:STORE,pathnames:['docs/*'],
     outsideApp:true,confirm:true}));
   expect(wild.status).toBe('refused_by_guard');
   expect(JSON.stringify(wild)).toMatch(/Wildcards are not accepted/);
   const gated=read(await f.del({store:STORE,pathnames:['a.txt'],
     confirm:true}));
   expect(gated.status).toBe('refused_by_guard');
   expect(JSON.stringify(gated)).toMatch(/outsideApp/);
   sdkHead.mockResolvedValueOnce(blobMeta('a.txt',3))
     .mockRejectedValueOnce(sdkError('BlobNotFoundError'));
   const plan=read(await f.del({store:STORE,
     pathnames:['a.txt','gone.txt'],outsideApp:true}));
   expect(plan.status).toBe('needs_confirmation');
   expect(plan.preview).toMatch(/a\.txt \(3 bytes\)/);
   expect(plan.preview).toMatch(/gone\.txt \(already absent\)/);
   expect(sdkDel).not.toHaveBeenCalled();
 });
 it('delete applies, verifies by read-back, and splits deleted from already-absent',async()=>{
   const f=fixture(); await f.connect();
   f.api.when('GET','/storage/stores/{id}').resolves({store:{
     status:'ready',usageQuotaExceeded:false,projectsMetadata:[]}});
   sdkHead.mockResolvedValueOnce(blobMeta('a.txt',3))
     .mockRejectedValue(sdkError('BlobNotFoundError'));
   sdkDel.mockResolvedValue(undefined);
   const r=read(await f.del({store:STORE,pathnames:['a.txt','gone.txt'],
     confirm:true,requestKey:'blob-del-test-1'}));
   expect(r).toMatchObject({status:'applied',confirmed:true,
     receipt:{deleted:['a.txt'],alreadyAbsent:['gone.txt']}});
   expect(sdkDel.mock.calls[0][0]).toEqual(['a.txt','gone.txt']);
   expect(sdkDel.mock.calls[0][1]).toEqual({token:TOKEN});
 });
});
