const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const services = require("../public/_server/native-services.cjs");
const { seedData, validateData } = require("../public/_server/recruitment.cjs");
const ExcelJS = require("exceljs");
const temp = () => fsp.mkdtemp(path.join(os.tmpdir(), "alkynes-native-"));
test("entity migration preserves original DB data, separates PDF bytes and supports compact snapshots and complete restore", async () => {
  const dir = await temp();
  let store;
  try {
    const data = seedData();
    data.candidates[0].resumeData =
      "data:application/pdf;base64," +
      Buffer.from("%PDF-1.4\n" + "a".repeat(600000)).toString("base64");
    data.candidates[0].resumeName = "synthetic.pdf";
    const db = new DatabaseSync(path.join(dir, "recruitment.sqlite"));
    db.exec(
      "CREATE TABLE workspace(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,payload TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO workspace VALUES(1,?,?,?)").run(
      9,
      new Date().toISOString(),
      JSON.stringify(data),
    );
    db.close();
    store = services.createEntityStore(dir);
    const oldDbFile=fs.readdirSync(dir).find(name=>name.startsWith('before-entity-migration-')&&name.endsWith('.sqlite'));
    assert.ok(oldDbFile);const oldDb=new DatabaseSync(path.join(dir,oldDbFile));assert.deepEqual(JSON.parse(oldDb.prepare('SELECT payload FROM workspace WHERE id=1').get().payload),data);oldDb.close();
    const compact = store.snapshot(true);
    assert.equal(compact.revision, 10);
    assert.ok(validateData(compact.data));
    assert.ok(JSON.stringify(compact.data).length < 50000);
    assert.equal(compact.data.candidates[0].resumeData, "");
    assert.match(compact.data.candidates[0].resumeId, /^[a-f0-9]{64}$/);
    assert.ok(
      store.attachment(compact.data.candidates[0].resumeId).length > 600000,
    );
    assert.equal(
      store.snapshot(false).data.candidates[0].resumeData,
      data.candidates[0].resumeData,
    );
    assert.ok(
      fs
        .readdirSync(dir)
        .some((name) => name.startsWith("before-entity-migration-")),
    );
    compact.data.candidates[0].appNotes = "보존할 메모";
    store.save(compact.data, 10);
    assert.throws(() => store.save(compact.data, 10), /다른 창/);
    const backup = store.backup("manual");
    const saved = JSON.parse(
      fs.readFileSync(path.join(store.directory(), backup)),
    );
    assert.equal(saved.candidates[0].resumeData, data.candidates[0].resumeData);
    const changed = store.snapshot(true);
    changed.data.candidates[0].appNotes = "나중 메모";
    store.save(changed.data, changed.revision);
    store.save(saved, 12, { beforeRestore: true });
    assert.equal(store.snapshot().data.candidates[0].appNotes, "보존할 메모");
    assert.ok(
      store.backupRows().some((x) => x.name.includes("before-restore")),
    );
    store.close();
    store = services.createEntityStore(dir);
    assert.equal(store.snapshot().data.candidates[0].appNotes, "보존할 메모");
    assert.equal(
      store.snapshot(false).data.candidates[0].resumeData,
      data.candidates[0].resumeData,
    );
  } finally {
    store?.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
test(
  "background sync runs without any browser; explicit IDs retain notes, evaluations and schedules through renames and row moves",
  { timeout: 60000 },
  async () => {
    const dir = await temp();
    const store = services.createEntityStore(path.join(dir, "config"));
    let sync;
    try {
      const empty = seedData();
      empty.requisitions = [];
      empty.candidates = [];
      empty.interviews = [];
      empty.evaluations = [];
      empty.activity = [];
      store.save(empty, 0);
      const book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet("채용프로세스 적시성");
      sheet.getRow(5).values = [
        "채용건명",
        "의뢰 부서",
        "의뢰자",
        "지원자명",
        "요청 구분",
        "요청일",
        "처리완료일",
        "처리기한",
        "기한 판정",
        "인적성 검사 일시",
        "면접 일시",
        "현재 선발 단계",
        "최종 결과",
        "실제 입사일",
        "비고",
      ];
      sheet.getRow(6).values = [
        "검증공고",
        "검증부서",
        "담당자",
        "검증지원자",
        "면접 요청",
        new Date("2026-10-25T00:00:00Z"),
        null,
        null,
        null,
        null,
        new Date("2026-10-28T14:00:00Z"),
        "",
        "미확정",
        null,
        "메모",
      ];
      sheet.getCell("P6").value = { formula: "1+1", result: 2 };
      const file = path.join(dir, "synthetic.xlsx");
      await book.xlsx.writeFile(file);
      let enabled = true;
      const source = {
        readConfig: async () => ({ path: file, enabled }),
        readWorkbook: async () => {
          const content = await fsp.readFile(file),
            stat = await fsp.stat(file);
          return {
            content,
            revision: require("node:crypto")
              .createHash("sha256")
              .update(content)
              .digest("hex"),
            modifiedAt: stat.mtime.toISOString(),
            name: "synthetic.xlsx",
          };
        },
      };
      sync = services.createSyncService({
        store,
        source,
        dataDir: path.join(dir, "config"),
      });
      async function waitFor(check) {
        for (let n = 0; n < 150; n++) {
          if (check()) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.fail(JSON.stringify(sync.status()));
      }
      await waitFor(() => store.snapshot().data.candidates.length === 1);
      assert.ok(sync.status().issues.some((x) => x.field === "현재 선발 단계"));
      let saved = store.snapshot(),
        person = saved.data.candidates[0],
        meeting = saved.data.interviews[0];
      const cid = person.id,
        iid = meeting.id;
      person.appNotes = "지원자 개인 메모";
      person.resumeName = "resume.pdf";
      person.resumeData =
        "data:application/pdf;base64," +
        Buffer.from("%PDF-1.4\nsynthetic").toString("base64");
      meeting.appNotes = "면접 개인 메모";
      meeting.interviewers = ["검증면접관"];
      saved.data.evaluations = [
        {
          id: "evaluation-fixed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          interviewId: iid,
          evaluator: "검증면접관",
          jobFit: "적합",
          capability: "적합",
          cultureFit: "적합",
          overall: "추천",
          comment: "보존할 평가",
        },
      ];
      store.save(saved.data, saved.revision);
      sheet.getCell("K6").value = new Date("2026-10-28T15:00:00Z");
      await book.xlsx.writeFile(file);
      await waitFor(
        () => store.snapshot().data.interviews[0].startsAt !== meeting.startsAt,
      );
      assert.equal(store.snapshot().data.interviews[0].id, iid);
      assert.equal(
        store.snapshot().data.interviews[0].appNotes,
        "면접 개인 메모",
      );
      const original = fs.readFileSync(file);
      const identified = await sync.identifiedCopy();
      assert.deepEqual(fs.readFileSync(file), original);
      const enriched = new ExcelJS.Workbook();
      await enriched.xlsx.load(identified);
      const tab = enriched.getWorksheet("채용프로세스 적시성");
      assert.equal(tab.getCell("P6").formula, "1+1");
      tab.getCell("D6").value = "이름수정검증";
      tab.getCell("K6").value = new Date("2026-10-29T15:00:00Z");
      const row = tab.getRow(6).values;
      tab.getRow(6).values = [];
      tab.getRow(9).values = row;
      await enriched.xlsx.writeFile(file);
      await waitFor(() =>
        store.snapshot().data.candidates.some((c) => c.name === "이름수정검증"),
      );
      saved = store.snapshot();
      assert.equal(saved.data.candidates.length, 1);
      assert.equal(saved.data.candidates[0].id, cid);
      assert.equal(saved.data.candidates[0].appNotes, "지원자 개인 메모");
      assert.ok(saved.data.candidates[0].resumeId);
      assert.equal(saved.data.interviews[0].id, iid);
      assert.equal(saved.data.interviews[0].appNotes, "면접 개인 메모");
      assert.equal(saved.data.evaluations[0].interviewId, iid);
      assert.equal(saved.data.evaluations[0].comment, "보존할 평가");
      const revision = saved.revision;
      await fsp.writeFile(file, "not an Excel file");
      await waitFor(() => sync.status().phase === "error");
      assert.equal(store.snapshot().revision, revision);
      assert.equal(store.snapshot().data.candidates[0].id, cid);
      await enriched.xlsx.writeFile(file);
      await waitFor(() => sync.status().phase === "synced");
      enabled = false;
      await sync.run();
      const paused = store.snapshot().revision;
      tab.getCell("D9").value = "일시중지중수정";
      await enriched.xlsx.writeFile(file);
      await new Promise((r) => setTimeout(r, 5500));
      assert.equal(store.snapshot().revision, paused);
      assert.equal(sync.status().phase, "paused");
    } finally {
      sync?.close();
      store.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
);
test("compact HTTP snapshots return 304 on unchanged revision and preserve full attachments only on explicit export", async () => {
  const dir = await temp(),
    store = services.createEntityStore(dir);
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port,
    handler = services.createStorageHandler({ store, port });
  server.on(
    "request",
    (req, res) =>
      void handler(req, res, new URL(req.url, "http://local").pathname),
  );
  const base = "http://127.0.0.1:" + port;
  try {
    const data = seedData();
    data.candidates[0].resumeData =
      "data:application/pdf;base64," +
      Buffer.from("%PDF-1.4\nfile").toString("base64");
    data.candidates[0].resumeName = "file.pdf";
    store.save(data, 0);
    const headers = { "X-Alkynes-Client": "1", "X-Alkynes-Compact": "1" };
    const first = await fetch(base + "/__alkynes/data", { headers }),
      body = await first.json();
    assert.equal(body.data.candidates[0].resumeData, "");
    assert.equal(
      (
        await fetch(base + "/__alkynes/data", {
          headers: { ...headers, "If-None-Match": first.headers.get("etag") },
        })
      ).status,
      304,
    );
    const full = await (
      await fetch(base + "/__alkynes/data/export", { headers })
    ).json();
    assert.equal(
      full.data.candidates[0].resumeData,
      data.candidates[0].resumeData,
    );
    assert.equal(
      (
        await fetch(
          base + "/__alkynes/attachments/" + body.data.candidates[0].resumeId,
        )
      ).status,
      200,
    );
    assert.equal((await fetch(base + "/__alkynes/data")).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
test("normalized writes roll back entity and attachment changes together on SQL failure", async () => {
  const dir = await temp(),
    store = services.createEntityStore(dir);
  try {
    const initial = seedData();
    store.save(initial, 0);
    const db = new DatabaseSync(path.join(dir, "recruitment.sqlite"));
    db.exec(
      "CREATE TRIGGER reject_record BEFORE INSERT ON records WHEN NEW.id='rejected-record' BEGIN SELECT RAISE(ABORT,'intentional write failure'); END;",
    );
    const next = store.snapshot().data;
    next.candidates.push({
      ...next.candidates[0],
      id: "rejected-record",
      resumeName: "new.pdf",
      resumeData:
        "data:application/pdf;base64," +
        Buffer.from("%PDF-1.4\nrollback").toString("base64"),
    });
    assert.throws(() => store.save(next, 1), /intentional/);
    assert.equal(store.snapshot().revision, 1);
    assert.equal(
      store.snapshot().data.candidates.length,
      initial.candidates.length,
    );
    assert.equal(
      Number(db.prepare("SELECT count(*) AS n FROM attachments").get().n),
      0,
    );
    db.close();
  } finally {
    store.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
test('an occupied application port cannot migrate or modify the existing database',async()=>{
 const root=await temp(),config=path.join(root,'config');let child;const occupied=http.createServer((req,res)=>res.end('existing process'));await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
 try{await fsp.cp(path.resolve(__dirname,'../portable'),root,{recursive:true});await fsp.cp(path.resolve(__dirname,'../public/_server'),path.join(root,'site','_server'),{recursive:true});await fsp.mkdir(config);const original=seedData(),db=new DatabaseSync(path.join(config,'recruitment.sqlite'));db.exec('CREATE TABLE workspace(id INTEGER PRIMARY KEY,revision INTEGER,updated_at TEXT,payload TEXT)');db.prepare('INSERT INTO workspace VALUES(1,1,?,?)').run(new Date().toISOString(),JSON.stringify(original));db.close();child=require('node:child_process').spawn(process.execPath,[path.join(root,'server.cjs')],{env:{...process.env,ALKYNES_PORT:String(occupied.address().port),ALKYNES_DATA_DIR:config},stdio:'ignore'});assert.equal(await new Promise(r=>child.once('exit',r)),1);const after=new DatabaseSync(path.join(config,'recruitment.sqlite'));assert.deepEqual(JSON.parse(after.prepare('SELECT payload FROM workspace').get().payload),original);after.close();assert.ok(!fs.readdirSync(config).some(name=>name.startsWith('before-entity-migration-')));}finally{child?.kill();occupied.closeAllConnections();await new Promise(r=>occupied.close(r));await fsp.rm(root,{recursive:true,force:true});}
});
