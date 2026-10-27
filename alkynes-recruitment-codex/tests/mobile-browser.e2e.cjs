const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const {createMobileHandler}=require('../portable/server.cjs');
test('acceptance message copies entered date/documents; mobile login shows same notebook data without write controls', {timeout:90000}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'alkynes-mobile-'));let child,browser,remote;
  const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const api=async(body)=>{const r=await fetch(base+'/__alkynes/data'+(body?'/migrate':''),{method:body?'POST':'GET',headers:{'X-Alkynes-Client':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
  try{
    await fs.cp(path.resolve(__dirname,'../portable'),root,{recursive:true});await fs.cp(path.resolve(__dirname,'../out'),path.join(root,'site'),{recursive:true});
    child=spawn(process.execPath,[path.join(root,'server.cjs')],{env:{...process.env,ALKYNES_PORT:String(port),ALKYNES_DATA_DIR:path.join(root,'config')},stdio:'ignore'});
    for(let n=0;n<60;n++){try{if((await fetch(base+'/__alkynes/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const {seedData}=require(path.join(root,'site/_server/recruitment.cjs'));const data=seedData();
    data.requisitions=[{...data.requisitions[0],id:'synthetic-job',role:'검증공고'}];
    data.candidates=[{...data.candidates[0],id:'synthetic-person',requisitionId:'synthetic-job',name:'검증지원자',status:'최종합격',expectedJoin:'2026-10-19'}];
    data.interviews=[];data.evaluations=[];data.activity=[];data.requests=[];
    await api({data,revision:0});
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/candidates');await page.getByRole('columnheader',{name:'출근일',exact:true}).waitFor();await page.getByRole('cell',{name:'전화로 협의 08시 30분',exact:true}).waitFor();await page.getByRole('button',{name:'합격 안내문',exact:true}).click();const dialog=page.getByRole('dialog',{name:'합격 안내문',exact:true});
    assert.equal(await dialog.getByLabel('출근일',{exact:true}).inputValue(),'');assert.equal(await dialog.getByRole('button',{name:'안내문 복사',exact:true}).isDisabled(),true);
    await dialog.getByLabel('제출서류',{exact:true}).fill('신분증 사본\n통장 사본');await dialog.getByLabel('출근일',{exact:true}).fill('2026-10-26');
    assert.equal(await dialog.getByRole('button',{name:'안내문 복사',exact:true}).isDisabled(),false);
    const additional=Array.from({length:12},(_,i)=>`추가 안내 ${i+1}: 첫날 정문으로 오세요.`).join('\n');
    await dialog.getByLabel('기타 안내사항 (선택)',{exact:true}).fill(additional);
    const text=await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue();assert.match(text,/2026년 10월 26일\(월\) 오전 08시 30분/);assert.match(text,/사무동 2층\(면접 본 건물\)/);assert.ok(text.includes(additional));assert.doesNotMatch(text,/기타 ?안내사항:/);
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(100);
      for(const label of ['제출서류','기타 안내사항 (선택)','카톡에 보낼 내용']) assert.equal(await dialog.getByLabel(label,{exact:true}).evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,label+' must show its full content');
    }
    await page.setViewportSize({width:1280,height:900});
    await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),text);assert.equal((await api()).revision,1);
    await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).fill(text+'\n추가 안내');await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/추가 안내$/);
    await dialog.getByRole('button',{name:'제출서류 삭제',exact:true}).click();assert.equal(await dialog.getByLabel('제출서류',{exact:true}).count(),0);
    const withoutDocuments=await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue();assert.doesNotMatch(withoutDocuments,/제출서류|신분증 사본|통장 사본/);assert.ok(withoutDocuments.includes(additional));
    await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),withoutDocuments);
    await dialog.getByRole('button',{name:'+ 제출서류 추가',exact:true}).click();assert.match(await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue(),/제출서류:\n신분증 사본/);
    await dialog.getByLabel('출근일',{exact:true}).fill('');assert.match(await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue(),/출근일: 전화로 협의/);assert.equal(await dialog.getByRole('button',{name:'안내문 복사',exact:true}).isDisabled(),false);
    await dialog.getByRole('button',{name:'공통 양식 저장',exact:true}).click();await dialog.getByText('제출서류·기타 안내를 공통 양식으로 저장했습니다.',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'초안 저장',exact:true}).click();await dialog.getByText('이 지원자의 초안을 저장했습니다.',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'합격 안내문',exact:true}).click();
    await dialog.getByLabel('제출서류',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('제출서류',{exact:true}).inputValue(),'신분증 사본\n통장 사본');assert.equal(await dialog.getByLabel('기타 안내사항 (선택)',{exact:true}).inputValue(),additional);
    await page.evaluate(()=>{window.__originalClipboard=navigator.clipboard;Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=command=>{if(command!=='copy')return false;const el=document.activeElement;window.__acceptanceCopied=el.value.slice(el.selectionStart,el.selectionEnd);return true;};});
    await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.equal(await page.evaluate(()=>window.__acceptanceCopied),await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue());
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:window.__originalClipboard}));
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();
    await page.goto(base+'/settings');await page.getByRole('heading',{name:'휴대폰 개인 접속',exact:true}).waitFor();await page.getByRole('status').filter({hasText:'휴대폰 접속 꺼짐'}).waitFor();
    const beforePhone=await api();beforePhone.data.candidates.push({...beforePhone.data.candidates[0],id:'synthetic-withdrawn',name:'검증포기자',status:'면접예정',expectedJoin:undefined});beforePhone.data.candidates.push({...beforePhone.data.candidates[0],id:'synthetic-hired',name:'검증입사자',status:'실제 입사',actualJoin:'2026-10-22'});beforePhone.data.interviews=[{...seedData().interviews[0],id:'synthetic-interview',candidateId:'synthetic-withdrawn',startsAt:'2026-10-22T05:00:00Z',status:'면접예정'}];
    async function update(snapshot){const response=await fetch(base+'/__alkynes/data',{method:'POST',headers:{'X-Alkynes-Client':'1','Content-Type':'application/json'},body:JSON.stringify({data:snapshot.data,revision:snapshot.revision})});assert.equal(response.status,200);}
    await update(beforePhone);
    async function copyInterviewMessage(view, url, fallback=false) {
      await view.goto(url+'/interviews');
      await view.getByRole('button',{name:'카톡 안내문 작성',exact:true}).click();
      await view.getByLabel('안내문 대상',{exact:true}).selectOption('synthetic-interview');
      await view.getByRole('button',{name:'안내문 열기',exact:true}).click();
      const notice=view.getByRole('dialog');
      await notice.getByLabel('공유 대상',{exact:true}).selectOption('candidate');
      const text=await notice.getByLabel('공유 안내문',{exact:true}).inputValue();
      assert.equal(text.split('\n').length,7);
      assert.match(text.split('\n')[0],/^안녕하세요, 알킨스 경영지원팀 민성진 과장입니다\. 검증포기자님, 검증공고 면접 일정 안내드립니다\.$/);
      assert.equal(text.split('\n')[3],'장소: (주) 알킨스 사무동 3층 영업부 회의실 (경기도 평택시 청북읍 청북중앙로 578-19)');
      if(fallback) await view.evaluate(()=>{
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
        document.execCommand=command=>{if(command!=='copy')return false;const input=document.activeElement;window.__copiedTest=input.value.slice(input.selectionStart,input.selectionEnd);return true;};
      });
      await notice.getByRole('button',{name:'카톡 메시지 복사',exact:true}).click();
      const copied=await view.evaluate(fallback=>fallback?window.__copiedTest:navigator.clipboard.readText(),fallback);
      assert.equal(copied,text);
      await notice.getByRole('button',{name:'닫기',exact:true}).last().click();
      return text;
    }
    const pcInterviewMessage=await copyInterviewMessage(page,base);
    const password='synthetic-password-123',salt='b'.repeat(32);let mobile;
    remote=http.createServer((req,res)=>{Object.defineProperty(req.socket,'remoteAddress',{value:'100.90.0.2',configurable:true});mobile(req,res);});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const remoteBase='http://127.0.0.1:'+remote.address().port;
    mobile=createMobileHandler({host:'127.0.0.1:'+remote.address().port,localPort:port,salt,passwordHash:crypto.scryptSync(password,salt,32).toString('hex')});
    const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),view=await phone.newPage();view.on('pageerror',e=>errors.push(e.message));await view.clock.install({time:new Date('2026-10-22T10:00:00+09:00')});
    await view.goto(remoteBase+'/candidates');await view.getByLabel('접속 비밀번호',{exact:true}).fill(password);await view.getByRole('button',{name:'조회 시작',exact:true}).click();await view.getByText('노트북 데이터 · 읽기 전용',{exact:true}).waitFor({timeout:10000}).catch(async e=>{console.log('Phone screen',view.url(),await view.locator('body').innerText());throw e;});
    await view.getByRole('button',{name:'최신 내용 불러오기',exact:true}).click();await view.waitForURL(url=>url.searchParams.has('_refresh'));await view.getByText('노트북 데이터 · 읽기 전용',{exact:true}).waitFor();await view.getByText('노트북 앱 버전 '+require('../portable/version.json').version,{exact:true}).waitFor();
    assert.equal(await view.getByRole('link',{name:'설정',exact:true}).count(),0);assert.equal(await view.getByRole('button',{name:'앱 업데이트',exact:true}).count(),0);
    assert.equal(await copyInterviewMessage(view,remoteBase,true),pcInterviewMessage);
    await view.getByRole('button',{name:'진단정보 복사',exact:true}).click();const diagnostic=await view.evaluate(()=>window.__copiedTest);assert.match(diagnostic,/현재 화면 버전: /);assert.match(diagnostic,/노트북 앱 버전: /);assert.ok(!diagnostic.includes('검증지원자'));
    await view.goto(remoteBase+'/dashboard');
    const calendar=view.getByLabel('채용 일정 캘린더',{exact:true});await calendar.waitFor();assert.equal(await calendar.locator('.calendar-grid').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    const box=await calendar.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=391);await calendar.getByRole('button',{name:/2026년 10월 22일/}).click();await calendar.getByLabel('선택한 날짜 일정',{exact:true}).getByText(/검증포기자/).waitFor();
    const todayWork=view.getByLabel('오늘 챙길 일',{exact:true});await todayWork.getByText(/검증포기자/).first().waitFor();assert.equal(await view.locator('.week-note').getByText(/검증포기자/).count(),0);const changed=await api();changed.data.candidates.find(c=>c.id==='synthetic-withdrawn').excelFinal='지원포기';await update(changed);await todayWork.getByText(/검증포기자/).first().waitFor({state:'detached',timeout:15000});
    await view.getByRole('link',{name:'지원자',exact:true}).click();await view.getByText('검증지원자',{exact:true}).waitFor();assert.equal(await view.getByRole('button',{name:'+ 지원자 등록',exact:true}).isDisabled(),true);
    await view.getByLabel('지원자 채용 분류',{exact:true}).selectOption('ended');await view.getByText('검증포기자',{exact:true}).waitFor();assert.equal(await view.getByText('검증입사자',{exact:true}).count(),0);
    await view.getByLabel('지원자 채용 분류',{exact:true}).selectOption('closed');await view.getByText('검증입사자',{exact:true}).waitFor();await view.getByRole('cell',{name:'2026년 10월 22일(목) 08시 30분',exact:true}).waitFor();assert.equal(await view.getByText('검증포기자',{exact:true}).count(),0);
    await view.getByLabel('지원자 채용 분류',{exact:true}).selectOption('active');
    await view.getByRole('button',{name:'상세 / 수정',exact:true}).click();const details=view.getByRole('dialog');assert.equal(await details.getByRole('button',{name:'저장',exact:true}).isDisabled(),true);assert.equal(await details.locator('input[name=name]').isDisabled(),true);
    await view.screenshot({path:path.join(root,'mobile-readonly.png'),fullPage:true});assert.equal((await api()).revision,changed.revision+1);await details.getByRole('button',{name:'닫기',exact:true}).click();await view.goto(remoteBase+'/interviews');await view.getByRole('button',{name:'카톡 안내문 작성',exact:true}).click();
    const openNotice=view.getByRole('dialog');await openNotice.getByLabel('공유 안내문',{exact:true}).fill('보존할 작성 중인 문구');
    const priorUrl=view.url();await view.route('**/__alkynes/health',route=>route.fulfill({json:{version:'9999.1.1'}}));await view.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await openNotice.getByRole('alert').filter({hasText:'새 버전의 안내문'}).waitFor();assert.equal(await openNotice.getByRole('button',{name:'카톡 메시지 복사',exact:true}).isDisabled(),true);assert.equal(await openNotice.getByLabel('공유 안내문',{exact:true}).inputValue(),'보존할 작성 중인 문구');assert.equal(view.url(),priorUrl);
    await openNotice.getByRole('button',{name:'닫기',exact:true}).last().click();await view.waitForURL(url=>url.href!==priorUrl);await view.getByText('노트북 데이터 · 읽기 전용',{exact:true}).waitFor();
    await view.unroute('**/__alkynes/health');await view.evaluate(()=>window.dispatchEvent(new Event('focus')));
    mobile=createMobileHandler({host:'127.0.0.1:'+remote.address().port,localPort:port,salt,passwordHash:crypto.scryptSync(password,salt,32).toString('hex')});await view.getByLabel('접속 비밀번호',{exact:true}).waitFor();assert.equal((await phone.request.get(remoteBase+'/__alkynes/data')).status(),401);assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();if(remote){remote.closeAllConnections();await new Promise(r=>remote.close(r));}if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}await fs.rm(root,{recursive:true,force:true});}
});
