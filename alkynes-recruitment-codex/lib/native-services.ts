import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseExcel, applyExcelSnapshot, type ExcelPlan } from "./excel";
import { changeSummary } from "./excel-changes";
import { stabilizePlan } from "./excel-integrity";
import { formatDate, validateData, type RecruitmentData } from "./recruitment";
const kinds = [
  "requisitions",
  "candidates",
  "interviews",
  "evaluations",
  "activity",
  "requests",
  "sharedNotices",
  "excelRuns",
] as const;
function atomic(file: string, value: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, value, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}
function fail(status: number, message: string): never {
  throw Object.assign(Error(message), { status });
}
export function createEntityStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, "recruitment.sqlite");
  const sql = new DatabaseSync(filename);
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,updated_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history(revision INTEGER PRIMARY KEY,updated_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS migration_backup(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,content BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS records_order ON records(kind,position);
  `);
  let restoreGeneration = 0;
  let cache: { revision: number; data: RecruitmentData } | undefined,
    backupWarning = "",
    backupTimer: ReturnType<typeof setTimeout> | undefined;
  const marker = (data: RecruitmentData) =>
    JSON.stringify({
      storageSchema: 2,
      fields: kinds.filter((kind) => Array.isArray(data[kind])),
    });
  const meta = () =>
    sql
      .prepare("SELECT revision,updated_at,payload FROM workspace WHERE id=1")
      .get() as
      | { revision: number; updated_at: string; payload: string }
      | undefined;
  function normalize(value: RecruitmentData) {
    const data = structuredClone(value);
    for (const c of data.candidates) {
      if (c.resumeData) {
        const content = Buffer.from(c.resumeData.split(",")[1], "base64");
        if (
          content.length > 1024 * 1024 ||
          content.subarray(0, 5).toString() !== "%PDF-"
        )
          fail(400, "이력서는 1MB 이하 PDF만 저장할 수 있습니다.");
        const id = createHash("sha256").update(content).digest("hex");
        sql
          .prepare("INSERT OR IGNORE INTO attachments(id,content) VALUES (?,?)")
          .run(id, content);
        c.resumeId = id;
        c.resumeData = "";
      } else if (
        c.resumeId &&
        (!/^[a-f0-9]{64}$/.test(c.resumeId) ||
          !sql.prepare("SELECT id FROM attachments WHERE id=?").get(c.resumeId))
      )
        fail(400, "연결된 이력서 파일을 확인하지 못했습니다.");
    }
    return data;
  }
  function persist(data: RecruitmentData) {
    for (const kind of kinds) {
      const rows = (data[kind] || []) as { id: string }[],
        old = sql
          .prepare("SELECT id,position,payload FROM records WHERE kind=?")
          .all(kind) as { id: string; position: number; payload: string }[];
      const existing = new Map(old.map((row) => [row.id, row])),
        seen = new Set<string>();
      for (const [position, row] of rows.entries()) {
        const payload = JSON.stringify(row),
          prior = existing.get(row.id);
        seen.add(row.id);
        if (!prior || prior.payload !== payload || prior.position !== position)
          sql
            .prepare(
              "INSERT INTO records(kind,id,position,payload) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET position=excluded.position,payload=excluded.payload",
            )
            .run(kind, row.id, position, payload);
      }
      for (const row of old)
        if (!seen.has(row.id))
          sql
            .prepare("DELETE FROM records WHERE kind=? AND id=?")
            .run(kind, row.id);
    }
  }
  function hydrate(value: RecruitmentData) {
    const data = structuredClone(value);
    for (const c of data.candidates)
      if (c.resumeId) {
        const file = sql
          .prepare("SELECT content FROM attachments WHERE id=?")
          .get(c.resumeId) as { content: Uint8Array } | undefined;
        if (!file) fail(500, "보관된 이력서를 찾지 못했습니다.");
        c.resumeData =
          "data:application/pdf;base64," +
          Buffer.from(file.content).toString("base64");
      }
    return data;
  }
  function snapshot(compact = true) {
    const row = meta();
    if (!row)
      return {
        data: null,
        revision: 0,
        updatedAt: "",
        databasePath: filename,
        storage: "sqlite",
        storageModel: "entities-v2",
      };
    if (!cache || cache.revision !== row.revision) {
      const data = { version: 1 } as RecruitmentData;
      const fields = JSON.parse(row.payload).fields || kinds;
      for (const kind of kinds)
        if (fields.includes(kind))
          (data as unknown as Record<string, unknown>)[kind] = sql
            .prepare(
              "SELECT payload FROM records WHERE kind=? ORDER BY position",
            )
            .all(kind)
            .map((r) => JSON.parse(String(r.payload)));
      if (!validateData(data))
        fail(500, "저장된 데이터를 검증하지 못했습니다.");
      cache = { revision: row.revision, data };
    }
    return {
      data: compact ? structuredClone(cache.data) : hydrate(cache.data),
      revision: row.revision,
      updatedAt: row.updated_at,
      databasePath: filename,
      storage: "sqlite",
      storageModel: "entities-v2",
      backupWarning,
    };
  }
  function directory() {
    const file = path.join(dataDir, "backup-settings.json");
    if (fs.existsSync(file)) {
      const v = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof v.directory !== "string" || !path.isAbsolute(v.directory))
        fail(400, "백업 폴더 경로를 확인하세요.");
      return v.directory;
    }
    return process.platform === "win32" && process.env.USERPROFILE
      ? path.join(
          process.env.USERPROFILE,
          "Documents",
          "AlkynesRecruitmentBackups",
        )
      : path.join(dataDir, "backups");
  }
  const backupPattern =
    /^alkynes-(daily-\d{4}-\d{2}-\d{2}|(?:manual|before-restore)-\d+-[a-f0-9]{8})\.json$/;
  function backupRows() {
    const dir = directory();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => backupPattern.test(n))
      .flatMap((name) => {
        const stat = fs.lstatSync(path.join(dir, name));
        return stat.isFile() && !stat.isSymbolicLink()
          ? [{ name, at: stat.mtime.toISOString(), size: stat.size }]
          : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }
  function backup(kind = "daily") {
    const data = snapshot(false).data;
    if (!data) return "";
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      dateStyle: "short",
    }).format(new Date());
    const suffix =
        kind === "daily" ? today : Date.now() + "-" + randomUUID().slice(0, 8),
      name = "alkynes-" + kind + "-" + suffix + ".json";
    atomic(path.join(directory(), name), JSON.stringify(data));
    for (const [prefix, limit] of [
      ["daily", 30],
      ["manual", 20],
      ["before-restore", 10],
    ] as const)
      for (const row of backupRows()
        .filter((row) => row.name.startsWith("alkynes-" + prefix + "-"))
        .slice(limit))
        fs.unlinkSync(path.join(directory(), row.name));
    backupWarning = "";
    return name;
  }
  function scheduledBackup() {
    if (backupTimer) return;
    backupTimer = setTimeout(() => {
      backupTimer = undefined;
      try {
        backup();
      } catch (e) {
        backupWarning = "자동 백업 실패: " + (e as Error).message;
      }
    }, 1000);
    backupTimer.unref();
  }
  // Preserve the complete old representation before a transactional schema migration.
  const legacy = meta();
  if (legacy && JSON.parse(legacy.payload).storageSchema !== 2) {
    const data = JSON.parse(legacy.payload);
    if (!validateData(data))
      fail(500, "기존 DB 검증 실패. 원본을 보존했습니다.");
    atomic(
      path.join(dataDir, "before-entity-migration-" + Date.now() + ".json"),
      legacy.payload,
    );
    const sqliteBackup = path.join(dataDir, 'before-entity-migration-' + Date.now() + '-' + randomUUID().slice(0,8) + '.sqlite');
    // VACUUM INTO includes WAL contents, unlike a plain filesystem copy.
    sql.exec("VACUUM INTO '" + sqliteBackup.replace(/'/g, "''") + "'");
    sql.exec("BEGIN IMMEDIATE");
    try {
      const current = meta();
      if (!current || current.revision !== legacy.revision || current.payload !== legacy.payload) fail(409, '다른 프로세스에서 기존 DB를 변경했습니다. 원본을 보존하고 이전을 중단했습니다.');
      persist(normalize(data));
      sql
        .prepare(
          "UPDATE workspace SET payload=?,revision=revision+1,updated_at=? WHERE id=1",
        )
        .run(marker(data), new Date().toISOString());
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
  function save(
    value: RecruitmentData,
    revision: number,
    options: {
      legacy?: RecruitmentData | null;
      beforeRestore?: boolean;
      migrating?: boolean;
    } = {},
  ) {
    if (!validateData(value))
      fail(400, "데이터 형식이나 연결 정보를 확인해 주세요.");
    sql.exec("BEGIN IMMEDIATE");
    try {
      const old = meta();
      if ((old?.revision || 0) !== revision || (options.migrating && old))
        fail(
          409,
          "다른 창에서 먼저 저장했습니다. 최신 내용을 확인하고 다시 저장해 주세요.",
        );
      if (options.beforeRestore && old) backup("before-restore");
      if (old)
        sql
          .prepare("INSERT OR REPLACE INTO history VALUES (?,?,?)")
          .run(
            old.revision,
            old.updated_at,
            JSON.stringify(snapshot(true).data),
          );
      if (options.legacy)
        sql
          .prepare("INSERT OR IGNORE INTO migration_backup VALUES (1,?,?)")
          .run(new Date().toISOString(), JSON.stringify(options.legacy));
      const next = normalize(value);
      persist(next);
      const at = new Date().toISOString();
      sql
        .prepare(
          "INSERT INTO workspace VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,payload=excluded.payload",
        )
        .run(revision + 1, at, marker(next));
      sql.exec(
        "DELETE FROM history WHERE revision NOT IN (SELECT revision FROM history ORDER BY revision DESC LIMIT 5)",
      );
      sql.exec("COMMIT");
      cache = { revision: revision + 1, data: next };
      if (options.beforeRestore) restoreGeneration++;
      scheduledBackup();
      return snapshot(true);
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
  function attachment(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    const row = sql
      .prepare("SELECT content FROM attachments WHERE id=?")
      .get(id) as { content: Uint8Array } | undefined;
    return row ? Buffer.from(row.content) : null;
  }
  return {
    snapshot,
    save,
    attachment,
    backup,
    backupRows,
    directory,
    info: meta,
    generation: () => restoreGeneration,
    configureBackup(dir: string) {
      if (!path.isAbsolute(dir)) fail(400, "전체 백업 경로가 필요합니다.");
      const probe = path.join(dir, ".probe-" + randomUUID());
      atomic(probe, "");
      fs.unlinkSync(probe);
      atomic(
        path.join(dataDir, "backup-settings.json"),
        JSON.stringify({ directory: dir }),
      );
      backup();
    },
    close() {
      if (backupTimer) {
        clearTimeout(backupTimer);
        try {
          backup();
        } catch {}
      }
      sql.close();
    },
  };
}
export type EntityStore = ReturnType<typeof createEntityStore>;
function send(
  res: http.ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(status === 304 ? undefined : JSON.stringify(value));
}
export function createStorageHandler({
  store,
  port,
}: {
  store: EntityStore;
  port: number;
}) {
  return async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string,
  ) => {
    const hosts = ["127.0.0.1:" + port, "localhost:" + port],
      file = name.startsWith("/__alkynes/attachments/");
    if (
      !hosts.includes(req.headers.host || "") ||
      (!file && req.headers["x-alkynes-client"] !== "1") ||
      (req.headers.origin &&
        !hosts.map((h) => "http://" + h).includes(req.headers.origin))
    )
      return send(res, 403, {
        error: "앱의 같은 주소에서만 사용할 수 있습니다.",
      });
    try {
      if (file) {
        if (req.method !== "GET") return send(res, 405, {});
        const content = store.attachment(
          name.slice("/__alkynes/attachments/".length),
        );
        if (!content)
          return send(res, 404, { error: "파일을 찾을 수 없습니다." });
        res.writeHead(200, {
          "Content-Type": "application/pdf",
                    "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(content);
      }
      if (
        ![
          "/__alkynes/data",
          "/__alkynes/data/migrate",
          "/__alkynes/data/export",
          "/__alkynes/data/backups",
          "/__alkynes/data/backups/file",
        ].includes(name)
      )
        return send(res, 404, {});
      if (req.method === "GET") {
        if (name.endsWith("/migrate")) return send(res, 405, {});
        if (name.endsWith("/backups/file")) {
          const filename =
            new URL(req.url || "/", "http://local").searchParams.get("name") ||
            "";
          if (!store.backupRows().some((row) => row.name === filename))
            return send(res, 404, { error: "백업 파일을 찾을 수 없습니다." });
          const data = JSON.parse(
            fs.readFileSync(path.join(store.directory(), filename), "utf8"),
          );
          if (!validateData(data)) fail(400, "백업 검증 실패");
          return send(res, 200, { data, name: filename });
        }
        if (name.endsWith("/backups"))
          return send(res, 200, {
            directory: store.directory(),
            files: store.backupRows(),
            error: "",
          });
        if (
          !name.endsWith("/export") &&
          req.headers["if-none-match"] ===
            '\"' + (store.info()?.revision || 0) + '\"'
        )
          return send(res, 304, null);
        const snapshot = store.snapshot(
          name.endsWith("/export")
            ? false
            : req.headers["x-alkynes-compact"] === "1",
        );
        if (
          !name.endsWith("/export") &&
          req.headers["if-none-match"] === '"' + snapshot.revision + '"'
        )
          return send(res, 304, null);
        return send(res, 200, snapshot, {
          ETag: '"' + snapshot.revision + '"',
        });
      }
      if (
        req.method !== "POST" ||
        name.endsWith("/file") ||
        name.endsWith("/export")
      )
        return send(res, 405, {});
      let length = 0;
      const parts: Buffer[] = [];
      for await (const part of req) {
        length += part.length;
        if (length > 128 * 1024 * 1024)
          return send(res, 413, {
            error: "저장 요청은 128MB 이하로 나눠 주세요.",
          });
        parts.push(part);
      }
      const body = JSON.parse(Buffer.concat(parts).toString());
      if (name.endsWith("/backups")) {
        if (body.action === "configure") {
          store.configureBackup(body.directory);
          return send(res, 200, { directory: store.directory(), error: "" });
        }
        if (body.action !== "create") fail(400, "백업 작업 확인 필요");
        return send(res, 200, {
          name: store.backup("manual"),
          directory: store.directory(),
        });
      }
      if (
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        (body.legacy && !validateData(body.legacy))
      )
        fail(400, "저장 버전이나 이전 데이터를 확인하세요.");
      const snapshot = store.save(body.data, body.revision, {
        legacy: body.legacy,
        beforeRestore: body.beforeRestore === true,
        migrating: name.endsWith("/migrate"),
      });
      return send(
        res,
        200,
        req.headers["x-alkynes-compact"] === "1"
          ? snapshot
          : { ...snapshot, data: undefined },
      );
    } catch (e) {
      send(res, (e as { status?: number }).status || 500, {
        error: (e as Error).message,
      });
    }
  };
}
export function createSyncService({
  store,
  source,
  dataDir,
}: {
  store: EntityStore;
  source: {
    readConfig: () => Promise<{ path: string; enabled: boolean }>;
    readWorkbook: (file: string) => Promise<{
      content: Buffer;
      revision: string;
      modifiedAt: string;
      name: string;
    }>;
  };
  dataDir: string;
}) {
  const statusFile = path.join(dataDir, "sync-status.json");
  let running = false,
    closed = false,
    lastHash = "",
    lastStat = "",
    currentPath = "",
    lastGeneration = 0,
    lastDay = "";
  let status: {
    phase: string;
    enabled: boolean;
    lastCheck: string;
    lastSuccess: string;
    sourceModifiedAt: string;
    sourceName: string;
    revision: string;
    dbRevision: number;
    message: string;
    issues: NonNullable<ExcelPlan["qualityIssues"]>;
  } = {
    phase: "idle",
    enabled: false,
    lastCheck: "",
    lastSuccess: "",
    sourceModifiedAt: "",
    sourceName: "",
    revision: "",
    dbRevision: 0,
    message: "자동 연결 대기",
    issues: [],
  };
  try {
    status = { ...status, ...JSON.parse(fs.readFileSync(statusFile, "utf8")) };
  } catch {}
  const set = (next: Partial<typeof status>) => {
    status = { ...status, ...next };
    atomic(statusFile, JSON.stringify(status));
  };
  async function run(force = false): Promise<typeof status> {
    if (closed) return status;
    if (running) {
      if (!force) return status;
      while (running && !closed)
        await new Promise((resolve) => setTimeout(resolve, 25));
      if (closed) return status;
      return run(force);
    }
    running = true;
    try {
      const config = await source.readConfig();
      set({ enabled: config.enabled, lastCheck: new Date().toISOString() });
      if (!config.path || (!config.enabled && !force)) {
        set({ phase: "paused", message: "자동 연결 중지" });
        return status;
      }
      if (!store.info()) {
        set({
          phase: "waiting",
          message: "처음 한 번 앱을 열어 기존 브라우저 자료를 이전해 주세요.",
        });
        return status;
      }
      const today = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul",dateStyle:"short"}).format(new Date());
      const stat = fs.statSync(config.path),
        signature = stat.size + ":" + stat.mtimeMs;
      if (
        !force &&
        currentPath === config.path &&
        lastStat === signature &&
        lastHash &&
        lastGeneration === store.generation() && lastDay === today
      ) {
        set({ phase: "synced", message: "파일 변경 없음" });
        return status;
      }
      const file = await source.readWorkbook(config.path);
      set({ sourceModifiedAt: file.modifiedAt, sourceName: file.name });
      if (
        currentPath === config.path &&
        lastHash === file.revision &&
        !force &&
        lastGeneration === store.generation() && lastDay === today
      ) {
        lastStat = signature;
        set({ phase: "synced", message: "파일 변경 없음" });
        return status;
      }
      const plan = await parseExcel(
        file.content.buffer.slice(
          file.content.byteOffset,
          file.content.byteOffset + file.content.byteLength,
        ) as ArrayBuffer,
        file.name,
      );
      plan.sourceModifiedAt = file.modifiedAt;
      const configAfter = await source.readConfig();
      if (configAfter.path !== config.path || (!force && !configAfter.enabled))
        throw Error("연결 설정이 변경되어 반영을 중단했습니다.");
      if (closed) return status;
      const latest = store.snapshot(true);
      if (!latest.data) throw Error("기존 자료 확인 필요");
      stabilizePlan(plan, latest.data);
      const previousRun = latest.data.excelRuns?.[0]?.id;
      const draft = structuredClone(latest.data);
      applyExcelSnapshot(draft, plan);
      const counts = draft.excelRuns?.[0]?.id !== previousRun ? draft.excelRuns?.[0]?.counts || {} : {};
      draft.activity.unshift({
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: "서버 자동 연동",
        message: "연결 Excel " + plan.rows + "행 자동 반영",
      });
      const saved = store.save(draft, latest.revision);
      currentPath = config.path;
      lastStat = signature;
      lastHash = file.revision;
      lastGeneration = store.generation();
      lastDay = today;
      set({
        phase: "synced",
        lastSuccess: new Date().toISOString(),
        revision: file.revision,
        dbRevision: saved.revision,
        issues: plan.qualityIssues || [],
        message:
          "엑셀 반영 완료 · " +
          changeSummary(counts) +
          " · " +
          plan.rows +
          "행" +
          (!config.enabled ? " · 자동 연결은 일시 중지 상태입니다." : ""),
      });
    } catch (e) {
      set({
        phase: "error",
        message:
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "연결한 엑셀 파일을 찾을 수 없습니다. 네이버웍스 동기화를 확인해 주세요."
            : (e as Error).message,
      });
    } finally {
      running = false;
    }
    return status;
  }
  const timer = setInterval(() => void run(), 5000);
  timer.unref();
  void run();
  async function identifiedCopy() {
    const config = await source.readConfig(),
      file = await source.readWorkbook(config.path),
      plan = await parseExcel(
        file.content.buffer.slice(
          file.content.byteOffset,
          file.content.byteOffset + file.content.byteLength,
        ) as ArrayBuffer,
        file.name,
      ),
      saved = store.snapshot(true);
    if (saved.data) stabilizePlan(plan, saved.data);
    const ExcelJS = (await import("exceljs")).default,
      book = new ExcelJS.Workbook();
    await book.xlsx.load(
      file.content as unknown as Parameters<typeof book.xlsx.load>[0],
    );
    const sheet = book.getWorksheet("채용프로세스 적시성")!;
    for (const [header, field] of [
      ["채용고유번호", "requisitionId"],
      ["지원자고유번호", "candidateId"],
      ["요청고유번호", "id"],
      ["면접고유번호", "interview"],
    ] as const) {
      let col = 0;
      sheet.getRow(5).eachCell((cell, n) => {
        if (
          [header, header.replace("고유번호", "ID")].includes(
            cell.text.replace(/\s/g, ""),
          )
        )
          col = n;
      });
      if (!col) col = sheet.columnCount + 1;
      sheet.getCell(5, col).value = header;
      for (const q of plan.requests) {
        if (!q.sourceRow) continue;
        const value =
          field === "interview"
            ? plan.interviews.find(
                (i) =>
                  i.candidateId === q.candidateId &&
                  (i.sourceRequestId === q.id ||
                    formatDate(i.startsAt) === q.excelValues?.["면접 일시"]),
              )?.id
            : q[field];
        sheet.getCell(q.sourceRow, col).value = value || "";
      }
      sheet.getColumn(col).hidden = true;
    }
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  return {
    run,
    status: () => ({ ...status, running }),
    identifiedCopy,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
