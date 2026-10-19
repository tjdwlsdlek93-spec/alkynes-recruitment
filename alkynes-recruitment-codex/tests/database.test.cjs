const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { createDataHandler } = require('../portable/server.cjs');
const filename = path.resolve(__dirname, '../lib/recruitment.ts');
const mod = new Module(filename);
mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  filename,
);
const { seedData, validateData } = mod.exports;
async function host(dataDir, run) {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port,
    handler = createDataHandler({ port, dataDir, validate: validateData });
  server.on(
    'request',
    (req, res) =>
      void handler(req, res, new URL(req.url, 'http://localhost').pathname),
  );
  const request = (body, suffix = '', headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/__alkynes/data' + suffix,
          method: body ? 'POST' : 'GET',
          headers: {
            'X-Alkynes-Client': '1',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode,
                body:
                  res.statusCode === 304
                    ? null
                    : JSON.parse(Buffer.concat(chunks)),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    await run(request);
  } finally {
    await new Promise((r) => server.close(r));
    handler.close();
  }
}
test('SQLite persists beyond browser quota, retains migration backup, rejects stale/invalid writes and survives restart', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alkynes-db-'));
  const initial = seedData(),
    big = structuredClone(initial);
  // Realistic multiple PDF attachments, each below the existing per-file validation limit.
  for (let n = 0; n < 8; n++)
    big.candidates.push({
      ...initial.candidates[0],
      id: 'large-' + n,
      name: '검증지원자' + n,
      resumeData:
        'data:application/pdf;base64,' +
        Buffer.from('%PDF-1.4\n' + 'a'.repeat(700000)).toString('base64'),
    });
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > 5 * 1024 * 1024);
  assert.ok(validateData(big));
  try {
    await host(dir, async (request) => {
      assert.equal((await request()).body.data, null);
      assert.equal(
        (
          await request(
            { data: initial, legacy: initial, revision: 0 },
            '/migrate',
          )
        ).status,
        200,
      );
      assert.equal((await request({ data: big, revision: 0 })).status, 409);
      assert.equal(
        (await request({ data: { ...big, candidates: [{}] }, revision: 1 }))
          .status,
        400,
      );
      assert.equal((await request()).body.revision, 1);
      assert.equal((await request({ data: big, revision: 1 })).status, 200);
      assert.equal(
        (await request(undefined, '', { 'If-None-Match': '"2"' })).status,
        304,
      );
      const race = await Promise.all([
        request({ data: initial, revision: 2 }),
        request({ data: initial, revision: 2 }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await request({ data: big, revision: 3 })).status, 200);
      assert.equal(
        (await request(undefined, '', { Origin: 'https://untrusted.test' }))
          .status,
        403,
      );
      assert.equal(
        (await request(undefined, '', { Host: 'untrusted.test' })).status,
        403,
      );
      assert.equal(
        (await request(undefined, '', { 'X-Alkynes-Client': '' })).status,
        403,
      );
      assert.equal(
        (await request(undefined, '/recruitment.sqlite')).status,
        404,
      );
    });
    await host(dir, async (request) => {
      const result = await request();
      assert.equal(result.body.revision, 4);
      assert.deepEqual(result.body.data, big);
    });
    const db = new DatabaseSync(path.join(dir, 'recruitment.sqlite'));
    assert.deepEqual(
      JSON.parse(
        db.prepare('SELECT payload FROM migration_backup').get().payload,
      ),
      initial,
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM history').get().n, 3);
    db.close();
    assert.equal(
      (await fsp.readFile(path.join(dir, 'recruitment.sqlite')))
        .subarray(0, 16)
        .toString(),
      'SQLite format 3\0',
    );
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
test('SQLite failures do not claim a successful save or replace the database with an empty workspace', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alkynes-db-bad-'));
  try {
    const file = path.join(dir, 'recruitment.sqlite');
    await fsp.writeFile(file, 'corrupt database');
    await host(dir, async (request) => {
      assert.equal((await request()).status, 500);
      assert.equal(
        (await request({ data: seedData(), revision: 0 })).status,
        500,
      );
    });
    assert.equal(await fsp.readFile(file, 'utf8'), 'corrupt database');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a failed SQL write rolls back both current records and history without reporting success', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alkynes-db-rollback-'));
  try {
    await host(dir, async (request) => {
      const initial = seedData();
      assert.equal(
        (await request({ data: initial, revision: 0 }, '/migrate')).status,
        200,
      );
      const db = new DatabaseSync(path.join(dir, 'recruitment.sqlite'));
      db.exec(
        "CREATE TRIGGER reject_update BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
      );
      const changed = structuredClone(initial);
      changed.requisitions[0].role = '저장되면 안 되는 변경';
      assert.equal((await request({ data: changed, revision: 1 })).status, 500);
      const result = await request();
      assert.equal(result.body.revision, 1);
      assert.deepEqual(result.body.data, initial);
      assert.equal(db.prepare('SELECT count(*) AS n FROM history').get().n, 0);
      db.close();
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('separate backups persist, verify restores, enforce retention and survive backup write failures without losing DB saves', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alkynes-backup-'));
  const initial = seedData();
  try {
    await host(dir, async request => {
      assert.equal((await request({ data: initial, revision:0 })).status,200);
      let status=await request(undefined,'/backups');assert.equal(status.status,200);
      assert.equal(status.body.files.length,1);
      const daily=status.body.files[0].name;
      assert.deepEqual(JSON.parse(await fsp.readFile(path.join(status.body.directory,daily),'utf8')),initial);
      const manual=await request({action:'create'},'/backups');assert.equal(manual.status,200);
      const saved=await request(undefined,'/backups/file?name='+manual.body.name);assert.deepEqual(saved.body.data,initial);
      assert.equal((await request(undefined,'/backups/file?name=../../recruitment.sqlite')).status,400);
      const next=structuredClone(initial);next.candidates[0].phone='복원 검증';
      assert.equal((await request({data:next,revision:1,beforeRestore:true})).status,200);
      status=await request(undefined,'/backups');
      const beforeRestore=status.body.files.find(f=>f.name.includes('before-restore'));
      assert.deepEqual(JSON.parse(await fsp.readFile(path.join(status.body.directory,beforeRestore.name),'utf8')),initial);
      assert.deepEqual(JSON.parse(await fsp.readFile(path.join(status.body.directory,daily),'utf8')),next);
      const directory=path.join(dir,'chosen-backups');
      assert.equal((await request({action:'configure',directory},'/backups')).status,200);
      for(let day=1;day<=35;day++){
        const date=new Date(Date.UTC(2024,0,day)).toISOString().slice(0,10),file=path.join(directory,'alkynes-daily-'+date+'.json');
        await fsp.writeFile(file,JSON.stringify(initial));await fsp.utimes(file,new Date(date),new Date(date));
      }
      status=await request(undefined,'/backups');assert.equal(status.body.files.length,30);
      assert.equal((await request({action:'configure',directory:'relative-folder'},'/backups')).status,400);
      const corrupt='alkynes-manual-123-abcdef12.json';await fsp.writeFile(path.join(directory,corrupt),'{}');
      assert.equal((await request(undefined,'/backups/file?name='+corrupt)).status,400);
      assert.deepEqual((await request()).body.data,next);
      const blocked=path.join(dir,'blocked');await fsp.writeFile(blocked,'a file is not a directory');
      await fsp.writeFile(path.join(dir,'backup-settings.json'),JSON.stringify({directory:blocked}));
      const final=structuredClone(next);final.candidates[0].phone='백업 실패 중에도 DB 저장';
      const ack=await request({data:final,revision:2});assert.equal(ack.status,200);assert.match(ack.body.backupWarning,/자동 백업 실패/);
      assert.deepEqual((await request()).body.data,final);
      assert.equal((await request({data:initial,revision:3,beforeRestore:true})).status,500);
      assert.deepEqual((await request()).body.data,final);
      assert.equal((await request({action:'configure',directory},'/backups')).status,200);
      assert.equal((await request(undefined,'/backups',{Origin:'https://untrusted.test'})).status,403);
    });
  } finally { await fsp.rm(dir,{recursive:true,force:true}); }
});
