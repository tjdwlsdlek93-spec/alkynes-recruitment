const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const source = __dirname;
const mode = process.argv[2] || 'start';
const url = 'http://127.0.0.1:8790/dashboard';
const payload = [
  'site',
  'runtime',
  'server.cjs',
  'excel-source.cjs',
  'update.cjs',
  'update-worker.cjs',
  'version.json',
  'source-default.json',
  'setup.cjs',
  'install-autostart.cmd',
  'start-app.cmd',
  'stop-app.cmd',
  'remove-autostart.cmd',
  'README.txt',
];
const quotePS = (s) => "'" + s.replace(/'/g, "''") + "'";
function ps(code) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(code, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw Error(
      result.error?.message ||
        result.stderr ||
        'Windows 설정 명령이 실패했습니다.',
    );
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function health() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8790/__alkynes/health', (res) => {
      const ours =
        res.statusCode === 200 &&
        res.headers['x-alkynes-app'] === 'portable-v1';
      res.resume();
      resolve(ours ? 'ours' : 'other');
    });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', () => resolve('offline'));
  });
}
function logError(root, error) {
  try {
    fs.appendFileSync(
      path.join(root, 'startup.log'),
      new Date().toISOString() + ' ' + error.message + '\n',
    );
  } catch {}
}
async function stop(root) {
  if ((await health()) !== 'ours') return;
  fs.writeFileSync(path.join(root, '.stop-request'), 'stop');
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    if ((await health()) !== 'ours') {
      await sleep(500);
      return;
    }
  }
  throw Error('서버 종료를 확인하지 못했습니다. 시작 로그를 확인하세요.');
}
async function start(root, openBrowser) {
  const state = await health();
  if (state === 'other')
    throw Error(
      '8790 포트를 다른 앱이 사용 중입니다. 다른 앱을 종료한 후 다시 실행하세요.',
    );
  if (state !== 'ours') {
    const node = path.join(root, 'runtime', 'node.exe'),
      script = path.join(root, 'server.cjs');
    const arg = quotePS('"' + script + '"');
    ps(
      "$ErrorActionPreference='Stop'; Start-Process -FilePath " +
        quotePS(node) +
        ' -ArgumentList ' +
        arg +
        ' -WorkingDirectory ' +
        quotePS(root) +
        ' -WindowStyle Hidden',
    );
    for (let i = 0; i < 100; i++) {
      if ((await health()) === 'ours') break;
      await sleep(200);
    }
    if ((await health()) !== 'ours')
      throw Error(
        '채용관리 서버 시작을 확인하지 못했습니다. 보안 프로그램이나 포트 사용 상태를 확인하세요.',
      );
  }
  if (openBrowser) {
    const child = spawn('explorer.exe', [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (e) =>
      console.error('브라우저를 직접 열어 주세요: ' + url, e.message),
    );
    child.unref();
  }
}
async function main() {
  if (process.platform !== 'win32')
    throw Error('이 설치 파일은 Windows 전용입니다.');
  const target = path.join(process.env.LOCALAPPDATA, 'AlkynesRecruitment');
  const shortcut = path.join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'Alkynes Recruitment.lnk',
  );
  let root = source;
  if (mode === 'install') {
    if (source.toLowerCase() !== target.toLowerCase()) {
      if (
        fs.existsSync(target) &&
        !fs.existsSync(path.join(target, '.alkynes-installed'))
      )
        throw Error(
          '설치 경로에 다른 파일이 있습니다. 기존 파일을 보호하기 위해 설치를 중단합니다.',
        );
      if (fs.existsSync(target)) await stop(target);
      fs.mkdirSync(target, { recursive: true });
      for (const name of payload)
        fs.cpSync(path.join(source, name), path.join(target, name), {
          recursive: true,
          force: true,
        });
    }
    root = target;
    fs.writeFileSync(
      path.join(target, '.alkynes-installed'),
      'Alkynes Recruitment portable v1',
    );
    const node = path.join(target, 'runtime', 'node.exe'),
      script = path.join(target, 'setup.cjs');
    const launch =
      "$ErrorActionPreference='Stop'; & " +
      quotePS(node) +
      ' ' +
      quotePS(script) +
      ' background';
    const args =
      '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' +
      Buffer.from(launch, 'utf16le').toString('base64');
    const register =
      "$ErrorActionPreference='Stop'; $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut(" +
      quotePS(shortcut) +
      '); $s.TargetPath=(Get-Command powershell.exe).Source; $s.Arguments=' +
      quotePS(args) +
      '; $s.WorkingDirectory=' +
      quotePS(target) +
      "; $s.WindowStyle=7; $s.Description='Alkynes recruitment auto start at Windows sign-in'; $s.Save()";
    fs.mkdirSync(path.dirname(shortcut), { recursive: true });
    ps(register);
    await start(target, true);
    console.log(
      '설치 및 자동 실행 등록 완료. Windows 로그인할 때 서버가 자동으로 실행됩니다.',
    );
    console.log('설치 폴더: ' + target + '\n브라우저 주소: ' + url);
  } else if (mode === 'remove') {
    if (fs.existsSync(shortcut)) fs.unlinkSync(shortcut);
    if (fs.existsSync(path.join(target, '.alkynes-installed')))
      await stop(target);
    console.log(
      '자동 실행을 해제했습니다. 앱 파일과 브라우저 저장 데이터는 삭제하지 않았습니다.',
    );
  } else if (mode === 'stop') {
    await stop(root);
    console.log('서버를 종료했습니다.');
  } else if (mode === 'start' || mode === 'background') {
    await start(root, mode === 'start');
  } else throw Error('지원하지 않는 실행 옵션입니다.');
}
main().catch((error) => {
  logError(source, error);
  console.error(error.message);
  process.exitCode = 1;
});
