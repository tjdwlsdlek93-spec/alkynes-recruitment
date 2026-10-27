const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright'), ExcelJS = require('exceljs');
test('workspace improvements survive Excel refresh, SQLite restart and confirmed backup restore', {timeout:120000}, async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'alkynes-workspace-')),config=path.join(root,'config');
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;let child,browser;
  async function start(){child=spawn(process.execPath,[path.join(root,'server.cjs')],{env:{...process.env,ALKYNES_PORT:String(port),ALKYNES_DATA_DIR:config},stdio:'ignore'});for(let n=0;n<60;n++){try{if((await fetch(base+'/__alkynes/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server did not start');}
  async function stop(){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
  async function api(body,suffix=''){const response=await fetch(base+'/__alkynes/data'+suffix,{method:body?'POST':'GET',headers:{'X-Alkynes-Client':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);return response.json();}
  try{
    await fs.cp(path.resolve(__dirname,'../portable'),root,{recursive:true});await fs.cp(path.resolve(__dirname,'../out'),path.join(root,'site'),{recursive:true});await fs.mkdir(config);
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('채용프로세스 적시성');
    sheet.getRow(5).values=['채용건명','의뢰 부서','의뢰자','지원자명','요청 구분','요청일','처리완료일','처리기한','기한 판정','인적성 검사 일시','면접 일시','현재 선발 단계','최종 결과','입사예정일','실제 입사일','비고'];
    sheet.getCell('AF5').value='면접장소';sheet.getCell('AG5').value='면접관';
    for(const [row,name,stage,time] of [[6,'검증갑','면접 요청','14:00'],[7,'검증을','면접 요청','14:30'],[8,'검증갑','인적성 검사 요청','']]){
      sheet.getRow(row).values=['업무검증채용','검증부서','담당자',name,stage,new Date('2026-10-20T09:00:00Z'),new Date('2026-10-21T09:00:00Z'),null,null,stage==='인적성 검사 요청'?new Date('2026-10-22T10:00:00Z'):null,time?new Date('2026-10-22T'+time+':00Z'):null,'면접예정','미확정',null,null,'원본 메모'];
      if(time){sheet.getCell('AF'+row).value='엑셀회의실';sheet.getCell('AG'+row).value='면접관갑';}
    }
    const file=path.join(root,'synthetic.xlsx');await book.xlsx.writeFile(file);
    await fs.utimes(file,new Date('2026-10-21T00:00:00Z'),new Date('2026-10-21T00:00:00Z'));
    await fs.writeFile(path.join(config,'excel-source.json'),JSON.stringify({path:file,enabled:false,pausedAt:new Date().toISOString()}));
    await start();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-22T10:00:00+09:00')});
    await page.goto(base+'/dashboard');await page.getByRole('heading',{name:'채용 현황',exact:true}).waitFor();
    const refresh=async()=>{await page.getByRole('button',{name:'엑셀 업데이트',exact:true}).click();await page.getByLabel('빠른 업데이트',{exact:true}).getByRole('status').filter({hasText:'엑셀 반영 완료'}).waitFor();};
    await refresh();let saved=await api();assert.equal(saved.data.interviews.length,2);assert.equal(saved.data.excelRuns.length,1);
    await page.route('**/__alkynes/sync/force',route=>route.fulfill({json:{background:true,enabled:true,phase:'review',message:'대량 변경 확인 필요 · 검증용 보류',lastSuccess:''}}));
    await page.getByRole('button',{name:'엑셀 업데이트',exact:true}).click();await page.getByLabel('빠른 업데이트',{exact:true}).getByRole('alert').filter({hasText:'대량 변경 확인 필요 · 검증용 보류'}).waitFor();assert.equal((await api()).revision,saved.revision);await page.unroute('**/__alkynes/sync/force');
    const todo = page.getByLabel('오늘 챙길 일',{exact:true});
    await todo.getByText('오늘 면접',{exact:true}).first().waitFor();
    assert.equal(await page.locator('.week-note a').count(),0);await page.locator('.week-note').getByText('오늘을 제외한 이번 주 면접이 없습니다.',{exact:true}).waitFor();
    await page.clock.setSystemTime(new Date('2026-10-21T10:00:00+09:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('.week-note a').length===2);
    await page.clock.setSystemTime(new Date('2026-10-22T10:00:00+09:00'));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('.week-note a').length===0);
    assert.equal(await page.getByLabel('엑셀 변경 내역',{exact:true}).count(),0);
    for(const width of [1440,1280]) {
      await page.setViewportSize({width,height:1100});
      const calendarBox=await page.getByLabel('채용 일정 캘린더',{exact:true}).boundingBox(),todoBox=await todo.boundingBox(),weekBox=await page.locator('.week-note').boundingBox();
      assert.ok(todoBox.x>=calendarBox.x+calendarBox.width-1,'tasks must sit beside calendar');
      assert.ok(Math.abs(todoBox.y-calendarBox.y)<3,'calendar must start alongside task paper');
      assert.ok(weekBox.y>=todoBox.y+todoBox.height,'tasks must precede weekly interviews');
    }
    assert.equal(await todo.evaluate(el=>getComputedStyle(el).animationName),'todo-paper-glow');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await todo.evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
    await page.screenshot({path:path.join(root,'dashboard-task-postit.png'),fullPage:true});
    await page.goto(base+'/interviews');await page.getByLabel('면접 일정 겹침',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'면접 안내문 복사',exact:true}).count(),0);
    await page.getByRole('button',{name:'상세 / 앱 메모',exact:true}).first().click();let dialog=page.getByRole('dialog');
    for(const selector of ['input[name=startsAt]','input[name=location]','input[name=interviewers]','select[name=status]'])assert.equal(await dialog.locator(selector).isDisabled(),true);
    await dialog.locator('input[name=durationMinutes]').fill('30');await dialog.locator('textarea[name=appNotes]').fill('유지할 면접 메모');await dialog.getByRole('button',{name:'저장',exact:true}).click();
    await page.getByText('개인 메모: 유지할 면접 메모',{exact:true}).waitFor();assert.equal(await page.getByLabel('면접 일정 겹침',{exact:true}).count(),0);
    await page.getByRole('button',{name:'카톡 안내문',exact:true}).first().click();dialog=page.getByRole('dialog');await dialog.getByRole('alert').filter({hasText:'엑셀 장소'}).waitFor();
    await dialog.getByRole('button',{name:'카톡 메시지 복사',exact:true}).click();assert.equal((await api()).data.sharedNotices?.length||0,0);
    await dialog.getByRole('button',{name:'안내 완료로 표시',exact:true}).click();await dialog.getByRole('button',{name:'미안내로 변경',exact:true}).waitFor();
    await dialog.getByLabel('공유 대상',{exact:true}).selectOption('candidate');await dialog.getByRole('button',{name:'안내 완료로 표시',exact:true}).click();await dialog.getByRole('button',{name:'미안내로 변경',exact:true}).waitFor();
    await dialog.getByLabel('지원자 회신',{exact:true}).selectOption('참석 확정');await page.waitForFunction(()=>document.querySelector('select[aria-label="지원자 회신"]')?.value==='참석 확정');
    const draftText=(await dialog.getByLabel('공유 안내문',{exact:true}).inputValue())+'\n초안 보관 확인';await dialog.getByLabel('공유 안내문',{exact:true}).fill(draftText);await dialog.getByRole('button',{name:'초안 저장',exact:true}).click();await dialog.getByText('초안을 저장했습니다.',{exact:true}).waitFor();
    assert.equal((await api()).data.sharedNotices.find(n=>n.audience==='candidate').reply,'참석 확정');
    await dialog.getByRole('button',{name:'닫기',exact:true}).last().click();assert.equal((await api()).data.sharedNotices.length,2);
    sheet.getCell('AF6').value='변경회의실';await book.xlsx.writeFile(file);await fs.utimes(file,new Date('2026-10-22T01:00:00Z'),new Date('2026-10-22T01:00:00Z'));await refresh();
    await page.getByText('지원자 · 변경 · 재안내 필요',{exact:true}).waitFor();await page.getByText('사내 · 변경 · 재안내 필요',{exact:true}).waitFor();
    saved=await api();assert.equal(saved.data.interviews[0].durationMinutes,30);assert.equal(saved.data.interviews[0].appNotes,'유지할 면접 메모');assert.equal(saved.data.excelRuns[0].counts['면접 변경'],1);
    sheet.getCell('P6').value='오늘 수정한 비고';await book.xlsx.writeFile(file);await fs.utimes(file,new Date('2026-10-22T02:00:00Z'),new Date('2026-10-22T02:00:00Z'));await refresh();
    const runCount=(await api()).data.excelRuns.length;await refresh();assert.equal((await api()).data.excelRuns.length,runCount);
    await page.goto(base+'/requests');const history=page.getByLabel('엑셀 변경 내역',{exact:true});
    assert.equal(await history.getByLabel('엑셀 수정일 선택',{exact:true}).inputValue(),'2026-10-22');
    await history.getByText('비고: 원본 메모 → 오늘 수정한 비고',{exact:false}).waitFor();
    await history.getByText('면접장소: 엑셀회의실 → 변경회의실',{exact:false}).first().waitFor();
    assert.equal(await history.locator('article').count(),2);
    await history.getByLabel('엑셀 수정일 선택',{exact:true}).selectOption('2026-10-21');
    await history.getByText('신규 면접',{exact:true}).first().waitFor();
    await history.getByLabel('엑셀 수정일 선택',{exact:true}).selectOption('2026-10-22');
    await history.getByLabel('엑셀 수정 내용 검색',{exact:true}).fill('비고');
    assert.equal(await history.locator('article').count(),1);
    await history.getByLabel('엑셀 수정 내용 검색',{exact:true}).fill('');
    await page.screenshot({path:path.join(root,'excel-daily-history.png'),fullPage:true});
    await page.goto(base+'/candidates');const personRow=page.getByRole('row').filter({hasText:'검증갑'});
    await personRow.getByText('업무검증채용',{exact:true}).waitFor();await personRow.getByText(/검증부서 · HR-/).waitFor();
    await page.getByLabel('지원자 검색',{exact:true}).fill('업무검증채용');assert.equal(await page.getByRole('button',{name:'진행 이력',exact:true}).count(),2);await page.getByLabel('지원자 검색',{exact:true}).fill('');
    await personRow.getByRole('button',{name:'진행 이력',exact:true}).click();
    const historyDialog=page.getByRole('dialog',{name:'검증갑 · 지원자 진행 이력',exact:true});
    await historyDialog.getByText('업무검증채용',{exact:true}).waitFor();assert.equal(await historyDialog.locator('details').evaluate(el=>el.open),true);
    await historyDialog.getByText('엑셀 반영 · 면접 변경',{exact:true}).waitFor();await historyDialog.getByRole('button',{name:'닫기',exact:true}).click();
    await personRow.getByRole('button',{name:'상세 / 수정',exact:true}).click();dialog=page.getByRole('dialog');
    assert.equal(await dialog.locator('input[name=name]').isDisabled(),true);await dialog.getByText(/지원자 진행 이력 ·/).click();await dialog.getByText('엑셀 반영 · 면접 변경',{exact:true}).waitFor();
    await dialog.locator('textarea[name=notes]').fill('유지할 지원자 메모');await dialog.getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await page.goto(base+'/aptitudes');await page.getByRole('button',{name:'상세 / 수정',exact:true}).click();dialog=page.getByRole('dialog');
    assert.equal(await dialog.locator('select[name=status]').isDisabled(),true);await dialog.locator('input[name=examDeadline]').fill('2026-10-23T18:00');await dialog.getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await page.getByRole('button',{name:'카톡 안내문',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'안내 완료로 표시',exact:true}).click();await dialog.getByRole('button',{name:'미안내로 변경',exact:true}).waitFor();await dialog.getByRole('button',{name:'닫기',exact:true}).last().click();
    await page.goto(base+'/settings');const backups=page.getByLabel('자동 백업',{exact:true});await backups.getByRole('button',{name:'지금 백업',exact:true}).click();await backups.getByText('별도 백업 파일을 저장했습니다.',{exact:true}).waitFor();
    const before=await api();const changed=structuredClone(before.data);changed.candidates.find(c=>c.name==='검증갑').appNotes='복원 전 변경';await api({data:changed,revision:before.revision});
    await page.reload();await backups.getByText(/저장된 백업 \d+개/).click();const manual=backups.locator('div.flex').filter({hasText:'수동 백업'});await manual.getByRole('button',{name:'복원 내용 미리보기',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'백업 복원 확인',exact:true});await dialog.getByRole('button',{name:'복원 확인',exact:true}).click();await dialog.waitFor({state:'detached'});
    assert.equal((await api()).data.candidates.find(c=>c.name==='검증갑').appNotes,'유지할 지원자 메모');
    const backupsAfter=await api(undefined,'/backups');assert.ok(backupsAfter.files.some(f=>f.name.includes('before-restore')));
    await page.screenshot({path:path.join(root,'workspace-improvements.png'),fullPage:true});await stop();await start();await page.reload();await page.getByText('노트북 SQLite 저장',{exact:true}).waitFor();assert.equal((await api()).data.sharedNotices.length,3);
    const privateSnapshot=await api(),privatePerson=privateSnapshot.data.candidates.find(c=>c.name==='검증갑');privatePerson.excelFinal='지원포기';await api({data:privateSnapshot.data,revision:privateSnapshot.revision});await page.reload();
    const privacy=page.getByLabel('개인정보 관리',{exact:true});await privacy.getByLabel('개인정보 삭제 대상',{exact:true}).selectOption(privatePerson.id);await privacy.getByLabel('개인정보 삭제 확인',{exact:true}).fill('개인정보 삭제');await privacy.getByRole('button',{name:'개인정보 삭제 실행',exact:true}).click();await privacy.getByText('개인정보를 삭제했습니다. 잠시 후 목록이 갱신됩니다.',{exact:true}).waitFor();assert.equal((await api()).data.candidates.find(c=>c.id===privatePerson.id).name,'개인정보 삭제');assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();await stop();await fs.rm(root,{recursive:true,force:true});}
});
