// SQLite lives under config/, outside the files replaced by app updates.
function createDataHandler({ port, dataDir, validate }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const databasePath = path.join(dataDir, 'recruitment.sqlite');
  let db;
  function open() {
    if (!db) {
      const { DatabaseSync } = require('node:sqlite');
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      db = new DatabaseSync(databasePath);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (revision INTEGER PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS migration_backup (id INTEGER PRIMARY KEY CHECK(id=1), created_at TEXT NOT NULL, payload TEXT NOT NULL);`);
    }
    return db;
  }
  function valid(value) {
    try {
      return validate(value);
    } catch {
      return false;
    }
  }
  const backupSettingsFile = path.join(dataDir, 'backup-settings.json');
  let backupError = '';
  const backupPattern = /^alkynes-(daily-\d{4}-\d{2}-\d{2}|(?:manual|before-restore)-\d+-[a-f0-9]{8})\.json$/;
  function backupDirectory() {
    try {
      const settings = JSON.parse(fs.readFileSync(backupSettingsFile, 'utf8'));
      if (typeof settings.directory !== 'string' || !path.isAbsolute(settings.directory)) throw Error('백업 폴더 설정을 확인해 주세요.');
      return settings.directory;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Documents', 'AlkynesRecruitmentBackups')
      : path.join(dataDir, 'backups');
  }
  function atomicFile(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + require('node:crypto').randomUUID() + '.tmp';
    try { fs.writeFileSync(tmp, contents, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  function backupRows(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => backupPattern.test(name)).map(name => {
      const stat = fs.lstatSync(path.join(directory, name));
      return { name, at: stat.mtime.toISOString(), size: stat.size, file: stat.isFile() && !stat.isSymbolicLink() };
    }).filter(row => row.file).sort((a,b) => b.at.localeCompare(a.at));
  }
  function writeBackup(payload, kind = 'daily', onlyIfMissing = false) {
    const directory = backupDirectory();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const suffix = kind === 'daily' ? today : Date.now() + '-' + require('node:crypto').randomBytes(4).toString('hex');
    const name = 'alkynes-' + kind + '-' + suffix + '.json';
    const file = path.join(directory, name);
    if (!onlyIfMissing || !fs.existsSync(file)) atomicFile(file, payload);
    // Keep 30 daily copies, 20 explicit copies, and 10 pre-restore snapshots.
    for (const [prefix, limit] of [['daily', 30], ['manual', 20], ['before-restore', 10]]) {
      for (const old of backupRows(directory).filter(row => row.name.startsWith('alkynes-' + prefix + '-')).slice(limit)) fs.unlinkSync(path.join(directory, old.name));
    }
    backupError = '';
    return name;
  }
  function dailyBackup(sql, onlyIfMissing = true) {
    try {
      const current = sql.prepare('SELECT payload FROM workspace WHERE id=1').get();
      if (current) { if (!valid(JSON.parse(current.payload))) throw Error('DB 데이터 검증 실패'); writeBackup(current.payload, 'daily', onlyIfMissing); }
    } catch (error) { backupError = '자동 백업 실패: ' + (error.code || error.message); }
  }
  const handler = async (req, res, name) => {
    const send = (status, value, headers = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Alkynes-App': 'portable-v1',
        ...headers,
      });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
    if (
      !hosts.includes(req.headers.host) ||
      req.headers['x-alkynes-client'] !== '1' ||
      (req.headers.origin &&
        !hosts.map((h) => 'http://' + h).includes(req.headers.origin))
    )
      return send(403, {
        error: '앱의 같은 주소에서만 저장소를 사용할 수 있습니다.',
      });
    if (!['/__alkynes/data', '/__alkynes/data/migrate', '/__alkynes/data/backups', '/__alkynes/data/backups/file'].includes(name))
      return send(404, { error: '저장소 경로를 확인해 주세요.' });
    if (
      !['GET', 'POST'].includes(req.method) ||
      (name.endsWith('/migrate') && req.method !== 'POST')
    )
      return send(405, { error: '허용되지 않은 요청입니다.' });
    try {
      const sql = open();
      if (name === '/__alkynes/data/backups/file' && req.method === 'GET') {
        const filename = new URL(req.url, 'http://localhost').searchParams.get('name') || '';
        if (!backupPattern.test(filename)) return send(400, { error: '백업 파일 이름을 확인해 주세요.' });
        const directory = backupDirectory(), file = path.join(directory, filename);
        if (!backupRows(directory).some(row => row.name === filename)) return send(404, { error: '백업 파일을 찾을 수 없습니다.' });
        const contents = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(contents);
        if (!valid(parsed)) return send(400, { error: '백업 파일을 검증하지 못했습니다. 현재 데이터는 유지됩니다.' });
        return send(200, { data: parsed, name: filename });
      }
      if (name === '/__alkynes/data/backups' && req.method === 'GET') {
        dailyBackup(sql);
        const directory = backupDirectory();
        return send(200, { directory, files: backupRows(directory), error: backupError });
      }
      if (req.method === 'GET') {
        dailyBackup(sql);
        const metadata = sql
          .prepare('SELECT revision FROM workspace WHERE id=1')
          .get();
        if (
          metadata &&
          req.headers['if-none-match'] === '"' + metadata.revision + '"'
        )
          return send(304);
        const row = sql.prepare('SELECT * FROM workspace WHERE id=1').get();
        const revision = row?.revision || 0;
        const data = row ? JSON.parse(row.payload) : null;
        if (row && !valid(data))
          throw Error(
            '저장된 DB 데이터를 검증하지 못했습니다. 백업을 확인해 주세요.',
          );
        return send(
          200,
          {
            data,
            revision,
            updatedAt: row?.updated_at || '',
            databasePath,
            storage: 'sqlite',
            backupWarning: backupError,
          },
          { ETag: '"' + revision + '"' },
        );
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 128 * 1024 * 1024)
          return send(413, {
            error: '한 번의 저장은 128MB 이하로 나눠 주세요.',
          });
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { error: '저장 형식이 올바르지 않습니다.' });
      }
      if (name === '/__alkynes/data/backups') {
        if (body?.action === 'configure') {
          if (typeof body.directory !== 'string' || !path.isAbsolute(body.directory) || body.directory.includes('\0')) return send(400, { error: '백업 폴더의 전체 경로를 입력해 주세요.' });
          const directory = path.normalize(body.directory);
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          // Verify write permission before replacing the previous setting.
          const probe = path.join(directory, '.alkynes-write-' + require('node:crypto').randomUUID());
          fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 }); fs.unlinkSync(probe);
          atomicFile(backupSettingsFile, JSON.stringify({ directory }));
          dailyBackup(sql, false);
          return send(200, { directory, error: backupError });
        }
        if (body?.action !== 'create') return send(400, { error: '백업 작업을 확인해 주세요.' });
        const row = sql.prepare('SELECT payload FROM workspace WHERE id=1').get();
        if (!row || !valid(JSON.parse(row.payload))) return send(400, { error: '백업할 데이터를 확인하지 못했습니다.' });
        const filename = writeBackup(row.payload, 'manual');
        return send(200, { name: filename, directory: backupDirectory() });
      }
      if (name.endsWith('/file')) return send(405, { error: '허용되지 않은 요청입니다.' });
      const migrating = name.endsWith('/migrate');
      if (
        !body ||
        !valid(body.data) ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        (migrating &&
          (body.revision !== 0 || (body.legacy != null && !valid(body.legacy))))
      )
        return send(400, {
          error: '데이터 형식이나 연결 정보를 확인해 주세요.',
        });
      sql.exec('BEGIN IMMEDIATE');
      try {
        const previous = sql
          .prepare('SELECT * FROM workspace WHERE id=1')
          .get();
        if (
          (previous?.revision || 0) !== body.revision ||
          (migrating && previous)
        ) {
          sql.exec('ROLLBACK');
          return send(409, {
            error:
              '다른 창에서 먼저 저장했습니다. 최신 내용을 확인하고 다시 저장해 주세요.',
          });
        }
        if (body.beforeRestore === true && previous) writeBackup(previous.payload, 'before-restore');
        const revision = body.revision + 1,
          updatedAt = new Date().toISOString();
        if (previous)
          sql
            .prepare('INSERT OR REPLACE INTO history VALUES (?, ?, ?)')
            .run(previous.revision, previous.updated_at, previous.payload);
        if (migrating && body.legacy)
          sql
            .prepare('INSERT OR IGNORE INTO migration_backup VALUES (1, ?, ?)')
            .run(updatedAt, JSON.stringify(body.legacy));
        sql
          .prepare(
            'INSERT INTO workspace VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload',
          )
          .run(revision, updatedAt, JSON.stringify(body.data));
        sql.exec(
          'DELETE FROM history WHERE revision NOT IN (SELECT revision FROM history ORDER BY revision DESC LIMIT 5)',
        );
        sql.exec('COMMIT');
        dailyBackup(sql, false);
        return send(200, {
          revision,
          updatedAt,
          databasePath,
          storage: 'sqlite',
          backupWarning: backupError,
        });
      } catch (error) {
        try {
          sql.exec('ROLLBACK');
        } catch {}
        throw error;
      }
    } catch (error) {
      send(500, {
        error:
          '노트북 DB를 읽거나 저장하지 못했습니다. 기존 데이터는 유지됩니다. ' +
          (error.code || error.message || ''),
      });
    }
  };
  handler.close = () => {
    if (db) {
      db.close();
      db = undefined;
    }
  };
  return handler;
}
// A separate read-only listener binds exclusively to a local Tailscale IPv4.
// Kept in server.cjs so older installed update workers copy this feature too.
function isTailnetIPv4(value) {
  if (require('node:net').isIP(value) !== 4) return false;
  const octets = value.split('.').map(Number);
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
function mobileAddresses() {
  return [...new Set(Object.values(require('node:os').networkInterfaces()).flat()
    .filter(row => row && !row.internal && isTailnetIPv4(row.address)).map(row => row.address))];
}
function createMobileHandler({ host, localPort, passwordHash, salt }) {
  const http = require('node:http'), crypto = require('node:crypto');
  const secret = crypto.randomBytes(32), attempts = new Map();
  const signature = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  const login = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>채용관리 · 개인 접속</title><style>body{font-family:system-ui;background:#f7f3e7;margin:0;padding:24px}main{max-width:360px;margin:12vh auto;padding:24px;border:1px solid #333;border-radius:16px;background:#fffdf5;box-shadow:4px 5px #333}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border:1px solid #888;border-radius:8px}button{background:#ffe56b;font-weight:bold}</style><main><h1>나만의 채용 보드</h1><p>노트북에서 설정한 접속 비밀번호를 입력하세요.</p><form method="post" action="/__alkynes/mobile/login"><label>접속 비밀번호<input name="password" type="password" required maxlength="200" autocomplete="current-password"></label><button>조회 시작</button></form><p>개인 VPN 연결 · 읽기 전용</p></main></html>';
  function send(res,code,body,type='text/plain; charset=utf-8',headers={}) {
    res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',...headers});res.end(body);
  }
  return async function mobile(req,res) {
    const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/,'');
    if (!isTailnetIPv4(peer) || req.headers.host !== host) return send(res,403,'개인 VPN에서만 접속할 수 있습니다.');
    let name;
    try { name = decodeURIComponent(new URL(req.url,'http://'+host).pathname); }
    catch { return send(res,400,'잘못된 주소입니다.'); }
    const origin = 'http://' + host;
    if (name === '/__alkynes/mobile/login' && req.method === 'POST') {
      if (req.headers.origin !== origin) return send(res,403,'접속 출처를 확인해 주세요.');
      const now = Date.now();
      for (const [key,value] of attempts) if (now - value.at > 600000) attempts.delete(key);
      const entry = attempts.get(peer) || {count:0,at:now};
      if (entry.count >= 5 || attempts.size >= 100) return send(res,429,'로그인 시도가 많습니다. 10분 뒤 다시 시도하세요.');
      entry.count++;attempts.set(peer,entry);
      try {
        let size=0; const chunks=[];
        for await (const chunk of req) { size+=chunk.length;if(size>4096)return send(res,413,'입력 길이를 확인하세요.');chunks.push(chunk); }
        const password = new URLSearchParams(Buffer.concat(chunks).toString()).get('password') || '';
        if (password.length>200 || !equal(crypto.scryptSync(password,salt,32).toString('hex'),passwordHash)) return send(res,401,'비밀번호가 맞지 않습니다. 뒤로 돌아가 다시 입력하세요.');
        attempts.delete(peer);
        const value = String(now);
        return send(res,303,'','text/plain',{'Location':'/dashboard','Set-Cookie':'alkynes_mobile='+value+'.'+signature(value)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'});
      } catch { return send(res,400,'로그인 요청을 확인해 주세요.'); }
    }
    const token = /(?:^|;\s*)alkynes_mobile=([0-9]+)\.([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    const authenticated = token && Number(token[1]) <= Date.now() && Date.now()-Number(token[1])<28800000 && equal(token[2],signature(token[1]));
    if (!authenticated) {
      if (name.startsWith('/__alkynes/')) return send(res,401,'로그인이 필요합니다.');
      return send(res,200,login,'text/html; charset=utf-8');
    }
    if (name === '/__alkynes/mobile/logout' && req.method === 'POST' && req.headers.origin === origin)
      return send(res,303,'','text/plain',{'Location':'/','Set-Cookie':'alkynes_mobile=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    if (!['GET','HEAD'].includes(req.method)) return send(res,403,'휴대폰에서는 조회만 가능합니다.');
    if (name === '/__alkynes/source') return send(res,200,JSON.stringify({path:'',enabled:false}),'application/json');
    const data = name === '/__alkynes/data';
    const pages = ['/', '/dashboard','/candidates','/requisitions','/aptitudes','/interviews','/evaluations'];
    const allowed = data || name === '/__alkynes/sync' || /^\/__alkynes\/attachments\/[a-f0-9]{64}$/.test(name) || name === '/__alkynes/health' || pages.some(p => name === p || (p!=='/' && name === p+'.txt')) || name.startsWith('/_next/static/') || /^\/(fonts|images)\//.test(name) || name === '/favicon.ico';
    if (!allowed || name.includes('..') || name.includes('\\') || name.includes('\0')) return send(res,403,'휴대폰 조회에서 사용할 수 없는 기능입니다.');
    const upstream = http.request({hostname:'127.0.0.1',port:localPort,path:req.url,method:'GET',headers:{Host:'127.0.0.1:'+localPort,'X-Alkynes-Client':'1','X-Alkynes-Compact':'1',...(req.headers['x-alkynes-delta']?{'X-Alkynes-Delta':req.headers['x-alkynes-delta']}:{}),...(req.headers['if-none-match']?{'If-None-Match':req.headers['if-none-match']}:{}),...(req.headers.rsc==='1'?{RSC:'1'}:{})},timeout:15000}, response => {
      if (data && response.statusCode===304) { response.resume(); return send(res,304,''); }
      if (data) {
        const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
          try {
            const body = JSON.parse(Buffer.concat(chunks));
            if(response.statusCode!==200 || body.storage!=='sqlite') return send(res,503,'노트북 데이터를 읽지 못했습니다.');
            send(res,200,JSON.stringify({data:body.data,...(body.changes?{changes:body.changes,baseRevision:body.baseRevision}:{}),revision:body.revision,updatedAt:body.updatedAt,storage:'sqlite',readOnly:true,databasePath:'',storageModel:body.storageModel}),'application/json',{ETag:'\"'+body.revision+'\"'});
          } catch { send(res,503,'노트북 데이터를 읽지 못했습니다.'); }
        });
      } else {
        res.writeHead(response.statusCode || 502,{'Content-Type':response.headers['content-type'] || 'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',...(response.headers.location?{Location:response.headers.location}:{})});
        if(req.method==='HEAD'){response.resume();res.end();}else response.pipe(res);
      }
    });
    upstream.on('timeout',()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)send(res,503,'노트북 앱 연결을 확인해 주세요.');else res.destroy();});
    res.on('close',()=>upstream.destroy());upstream.end();
  };
}
function createMobileAccess({port,dataDir}) {
  const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
  const configFile=path.join(dataDir,'mobile-access.json'),mobilePort=port+1;
  let config={enabled:false},listener=null,error='',starting=false;
  try{config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{}
  const status=()=>({enabled:config.enabled===true,connected:!!listener?.listening,address:config.address || '',port:mobilePort,addresses:mobileAddresses(),url:listener?.listening?'http://'+config.address+':'+mobilePort:'',error});
  function start() {
    if(!config.enabled || listener || starting)return;
    if(!isTailnetIPv4(config.address) || !mobileAddresses().includes(config.address)) {error='Tailscale 연결을 확인하세요. 연결되면 자동으로 다시 시도합니다.';return;}
    if(!/^[a-f0-9]{64}$/.test(config.passwordHash || '') || !/^[a-f0-9]{32}$/.test(config.salt || '')) {error='접속 비밀번호를 다시 설정해 주세요.';return;}
    starting=true;
    const instance=http.createServer(createMobileHandler({host:config.address+':'+mobilePort,localPort:port,passwordHash:config.passwordHash,salt:config.salt}));
    listener=instance;
    instance.requestTimeout=20000;instance.headersTimeout=10000;
    instance.on('error',()=>{if(listener===instance)listener=null;starting=false;error='휴대폰 접속 포트를 열지 못했습니다. VPN과 포트 사용 여부를 확인하세요.';});
    instance.listen(mobilePort,config.address,()=>{starting=false;error='';});
  }
  function stop(){const old=listener;listener=null;starting=false;if(old){old.close();old.closeAllConnections();}}
  const timer=setInterval(start,30000);timer.unref();start();
  async function handle(req,res) {
    const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    const peer=(req.socket.remoteAddress || '').replace(/^::ffff:/,'');
    const hosts=['127.0.0.1:'+port,'localhost:'+port];
    if(!['127.0.0.1','::1'].includes(peer) || !hosts.includes(req.headers.host) || req.headers['x-alkynes-client']!=='1' || (req.headers.origin && !hosts.map(h=>'http://'+h).includes(req.headers.origin))) return send(403,{error:'노트북 앱에서만 설정할 수 있습니다.'});
    if(req.method==='GET')return send(200,status());
    if(req.method!=='POST')return send(405,{error:'허용되지 않은 요청입니다.'});
    try {
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)return send(413,{error:'입력 길이를 확인하세요.'});chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks));
      let next={...config,enabled:body.enabled===true};
      if(next.enabled){
        if(!isTailnetIPv4(body.address) || !mobileAddresses().includes(body.address))return send(400,{error:'이 노트북의 연결된 Tailscale IPv4를 선택해 주세요.'});
        next.address=body.address;
        if(body.password){if(typeof body.password!=='string' || body.password.length<12 || body.password.length>200)return send(400,{error:'비밀번호는 12~200자로 설정해 주세요.'});next.salt=crypto.randomBytes(16).toString('hex');next.passwordHash=crypto.scryptSync(body.password,next.salt,32).toString('hex');}
        if(!next.passwordHash)return send(400,{error:'최초 연결 시 접속 비밀번호가 필요합니다.'});
      }
      fs.mkdirSync(dataDir,{recursive:true});const temp=configFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,configFile);
      stop();config=next;error='';start();return send(200,status());
    }catch{return send(400,{error:'접속 설정을 저장하지 못했습니다.'});}
  }
  handle.close=()=>{clearInterval(timer);stop();};return handle;
}

function startServer() {
  const http = require('node:http');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, 'site');
  const port = Number(process.env.ALKYNES_PORT || 8790);
  const { createSourceHandler } = require('./excel-source.cjs');
  const handleSource = createSourceHandler({
    port,
    dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'),
    defaultFile: path.join(__dirname, 'source-default.json'),
  });
  const { createUpdateHandler } = require('./update.cjs');
  const version = require('./version.json').version;
  const handleUpdate = createUpdateHandler({
    root: __dirname,
    port,
    dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config'),
    stop: () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    },
  });
  const services = require(path.join(root, '_server/native-services.cjs'));
  const dataDir = process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config');
  let store, handleData, sync;
  const handleMobile = createMobileAccess({ port, dataDir: process.env.ALKYNES_DATA_DIR || path.join(__dirname, 'config') });
  const stopFile = path.join(__dirname, '.stop-request');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  function reply(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Alkynes-App': 'portable-v1',
    });
    res.end(body);
  }
  const server = http.createServer((req, res) => {
    let name;
    try {
      name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return reply(res, 400, 'Bad request');
    }
    if (name === '/__alkynes/mobile') { void handleMobile(req, res); return; }
    if (['/__alkynes/sync','/__alkynes/sync/force','/__alkynes/sync/approve','/__alkynes/source/identified'].includes(name)) {
      const hosts = ['127.0.0.1:'+port,'localhost:'+port];
      if (!hosts.includes(req.headers.host) || req.headers['x-alkynes-client']!=='1' || (req.headers.origin && !hosts.map(h=>'http://'+h).includes(req.headers.origin))) return reply(res,403,'Forbidden');
      if (((name.endsWith('/force') || name.endsWith('/approve')) && req.method!=='POST') || (!(name.endsWith('/force') || name.endsWith('/approve')) && req.method!=='GET')) return reply(res,405,'Method not allowed');
      void (async()=>{try {
        if(name.endsWith('/identified')) { const content=await sync.identifiedCopy(); res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store'});return res.end(content); }
        const status=name.endsWith('/approve')?await sync.approve():name.endsWith('/force')?await sync.run(true):sync.status();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...status,background:true}));
      } catch(e) {res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.message}));}})(); return;
    }
    if (name.startsWith('/__alkynes/data') || name.startsWith('/__alkynes/attachments/')) {
      void handleData(req, res, name);
      return;
    }
    if (name.startsWith('/_server/')) return reply(res, 403, 'Forbidden');
    if (name.startsWith('/__alkynes/update')) {
      void handleUpdate(req, res, name);
      return;
    }
    if (name.startsWith('/__alkynes/source')) {
      void handleSource(req, res, name);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method))
      return reply(res, 405, 'Method not allowed');
    if (name === '/__alkynes/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Alkynes-App': 'portable-v1',
      });
      return res.end(
        JSON.stringify({
          app: 'alkynes-recruitment',
          ready: true,
          version,
          storage: 'sqlite',
        }),
      );
    }
    if (name === '/') {
      res.writeHead(302, { Location: '/dashboard' });
      return res.end();
    }
    let file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || name.includes('\0'))
      return reply(res, 403, 'Forbidden');
    if (!path.extname(file)) file += req.headers.rsc === '1' ? '.txt' : '.html';
    try {
      if (!fs.realpathSync(file).startsWith(root + path.sep))
        return reply(res, 403, 'Forbidden');
      const stat = fs.statSync(file);
      if (!stat.isFile()) return reply(res, 404, 'Not found');
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'X-Content-Type-Options': 'nosniff',
        'X-Alkynes-App': 'portable-v1',
        'Cache-Control': name.startsWith('/_next/static/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch {
      reply(res, 404, 'Not found');
    }
  });
  server.on('close', () => { sync?.close(); handleMobile.close(); store?.close(); });
  server.on('error', (error) => {
    handleMobile.close();
    console.error('채용관리 서버를 시작하지 못했습니다:', error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    try {
      // Claim the application port before opening or migrating any existing database.
      store = services.createEntityStore(dataDir);
      handleData = services.createStorageHandler({ store, port });
      sync = services.createSyncService({ store, source: handleSource, dataDir });
    } catch (error) {
      console.error('저장소를 준비하지 못했습니다. 기존 백업을 유지합니다:', error.message);
      process.exitCode = 1; server.close(); return;
    }
    console.log('알킨스 채용관리: http://127.0.0.1:' + port);
    if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
    fs.watchFile(stopFile, { interval: 500 }, () => {
      if (!fs.existsSync(stopFile)) return;
      fs.unlinkSync(stopFile);
      fs.unwatchFile(stopFile);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    });
  });
}
if (require.main === module) startServer();
module.exports = { createDataHandler, createMobileHandler, createMobileAccess, isTailnetIPv4 };
