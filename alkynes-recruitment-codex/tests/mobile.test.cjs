const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {createMobileHandler,isTailnetIPv4}=require('../portable/server.cjs');
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
test('private mobile login exposes only read-only snapshot and static pages; forged APIs and non-VPN clients are rejected',async()=>{
  const calls=[];
  const local=http.createServer((req,res)=>{calls.push(req.url);if(req.headers['if-none-match']==='\"4\"'){res.writeHead(304);return res.end();}assert.equal(req.headers['x-alkynes-client'],'1');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({storage:'sqlite',data:{test:true},revision:4,databasePath:'PRIVATE_PATH',backupWarning:'PRIVATE_BACKUP'}));});
  const localPort=await listen(local);let handler;
  const server=http.createServer((req,res)=>{Object.defineProperty(req.socket,'remoteAddress',{value:req.headers['x-test-peer'] || '100.90.0.2',configurable:true});handler(req,res);});
  const port=await listen(server),host='127.0.0.1:'+port,base='http://'+host,password='synthetic-password-123',salt='a'.repeat(32);
  handler=createMobileHandler({host,localPort,salt,passwordHash:crypto.scryptSync(password,salt,32).toString('hex')});
  try {
    for(const value of ['100.64.0.1','100.127.255.254'])assert.equal(isTailnetIPv4(value),true);
    for(const value of ['127.0.0.1','0.0.0.0','100.128.0.1','100.63.0.1','example.com','100.090.0.1'])assert.equal(isTailnetIPv4(value),false);
    assert.equal((await fetch(base+'/dashboard',{headers:{'x-test-peer':'192.168.1.1'}})).status,403);
    assert.equal((await fetch(base+'/__alkynes/data')).status,401);
    assert.match(await(await fetch(base+'/dashboard')).text(),/접속 비밀번호/);
    const login=headers=>fetch(base+'/__alkynes/mobile/login',{method:'POST',headers,body:new URLSearchParams({password}),redirect:'manual'});
    assert.equal((await login({Origin:'http://evil.example'})).status,403);
    const response=await login({Origin:base});assert.equal(response.status,303);
    const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const read=await fetch(base+'/__alkynes/data',{headers:{Cookie:cookie}});const body=await read.json();assert.equal(read.headers.get('etag'),'\"4\"');assert.equal((await fetch(base+'/__alkynes/data',{headers:{Cookie:cookie,'If-None-Match':'\"4\"'}})).status,304);assert.equal(body.readOnly,true);assert.equal(body.databasePath,'');assert.equal(body.backupWarning,undefined);assert.equal(JSON.stringify(body).includes('PRIVATE'),false);
    for(const path of ['/__alkynes/data','/__alkynes/data/migrate','/__alkynes/update/apply','/__alkynes/source','/__alkynes/mobile'])assert.equal((await fetch(base+path,{method:'POST',headers:{Cookie:cookie,Origin:base,'X-Alkynes-Client':'1'},body:'{}'})).status,403);
    for(const path of ['/__alkynes/data/backups','/__alkynes/data/backups/file','/_server/recruitment.cjs','/settings','/requests','/config/mobile-access.json','/__alkynes/update','/__alkynes/source/file'])assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,403);
    assert.equal((await fetch(base+'/__alkynes/source',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(base+'/__alkynes/data',{headers:{Cookie:cookie+'x'}})).status,401);
    const wrong=()=>fetch(base+'/__alkynes/mobile/login',{method:'POST',headers:{Origin:base},body:'password=incorrect',redirect:'manual'});
    for(let n=0;n<5;n++)assert.equal((await wrong()).status,401);assert.equal((await wrong()).status,429);
    assert.deepEqual(calls,['/__alkynes/data','/__alkynes/data']);
  } finally {server.closeAllConnections();local.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>local.close(r))]);}
});
test('local mobile settings reject broad/nonlocal addresses, preserve disabled state and never reveal password hashes',async()=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {createMobileAccess}=require('../portable/server.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mobile-settings-'));let handle;
  const server=http.createServer((req,res)=>handle(req,res)),port=await listen(server);handle=createMobileAccess({port,dataDir:root});const base='http://127.0.0.1:'+port;
  const api=body=>fetch(base+'/__alkynes/mobile',{method:body?'POST':'GET',headers:{'X-Alkynes-Client':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await fetch(base+'/__alkynes/mobile')).status,403);
    assert.equal((await fetch(base+'/__alkynes/mobile',{headers:{'X-Alkynes-Client':'1',Origin:'http://evil.example'}})).status,403);
    assert.equal((await(await api()).json()).enabled,false);
    for(const address of ['0.0.0.0','127.0.0.1','192.168.1.2'])assert.equal((await api({enabled:true,address,password:'synthetic-password-123'})).status,400);
    assert.equal((await api({enabled:false})).status,200);handle.close();
    handle=createMobileAccess({port,dataDir:root});const status=await(await api()).json();assert.equal(status.enabled,false);assert.equal(status.passwordHash,undefined);assert.equal(status.salt,undefined);
  }finally{handle.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
