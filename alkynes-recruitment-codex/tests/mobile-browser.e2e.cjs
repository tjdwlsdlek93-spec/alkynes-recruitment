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
    data.candidates=[{...data.candidates[0],id:'synthetic-person',requisitionId:'synthetic-job',name:'검증지원자',status:'최종합격',expectedJoin:'2026-10-22'}];
    data.interviews=[];data.evaluations=[];data.activity=[];data.requests=[];
    await api({data,revision:0});
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/candidates');await page.getByRole('button',{name:'합격 안내문',exact:true}).click();const dialog=page.getByRole('dialog',{name:'합격 안내문',exact:true});
    assert.equal(await dialog.getByLabel('출근일',{exact:true}).inputValue(),'2026-10-22');assert.equal(await dialog.getByRole('button',{name:'안내문 복사',exact:true}).isDisabled(),true);
    await dialog.getByLabel('제출서류',{exact:true}).fill('신분증 사본\n통장 사본');await dialog.getByLabel('출근일',{exact:true}).fill('2026-10-26');
    const text=await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).inputValue();assert.match(text,/2026년 10월 26일\(월\) 오전 08시 30분/);assert.match(text,/사무동 2층\(면접 본 건물\)/);
    await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),text);assert.equal((await api()).revision,1);
    await dialog.getByLabel('카톡에 보낼 내용',{exact:true}).fill(text+'\n추가 안내');await dialog.getByRole('button',{name:'안내문 복사',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/추가 안내$/);
    await page.goto(base+'/settings');await page.getByRole('heading',{name:'휴대폰 개인 접속',exact:true}).waitFor();await page.getByRole('status').filter({hasText:'휴대폰 접속 꺼짐'}).waitFor();
    const password='synthetic-password-123',salt='b'.repeat(32);let mobile;
    remote=http.createServer((req,res)=>{Object.defineProperty(req.socket,'remoteAddress',{value:'100.90.0.2',configurable:true});mobile(req,res);});await new Promise(r=>remote.listen(0,'127.0.0.1',r));const remoteBase='http://127.0.0.1:'+remote.address().port;
    mobile=createMobileHandler({host:'127.0.0.1:'+remote.address().port,localPort:port,salt,passwordHash:crypto.scryptSync(password,salt,32).toString('hex')});
    const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),view=await phone.newPage();view.on('pageerror',e=>errors.push(e.message));
    await view.goto(remoteBase+'/candidates');await view.getByLabel('접속 비밀번호',{exact:true}).fill(password);await view.getByRole('button',{name:'조회 시작',exact:true}).click();await view.getByText('노트북 데이터 · 읽기 전용',{exact:true}).waitFor({timeout:10000}).catch(async e=>{console.log('Phone screen',view.url(),await view.locator('body').innerText());throw e;});
    assert.equal(await view.getByRole('link',{name:'설정',exact:true}).count(),0);assert.equal(await view.getByRole('button',{name:'앱 업데이트',exact:true}).count(),0);
    await view.getByRole('link',{name:'지원자',exact:true}).click();await view.getByText('검증지원자',{exact:true}).waitFor();assert.equal(await view.getByRole('button',{name:'+ 지원자 등록',exact:true}).isDisabled(),true);
    await view.getByRole('button',{name:'상세 / 수정',exact:true}).click();const details=view.getByRole('dialog');assert.equal(await details.getByRole('button',{name:'저장',exact:true}).isDisabled(),true);assert.equal(await details.locator('input[name=name]').isDisabled(),true);
    await view.screenshot({path:'/workspace/scratch/mobile-readonly.png',fullPage:true});assert.equal((await api()).revision,1);await details.getByRole('button',{name:'닫기',exact:true}).click();await view.getByRole('button',{name:'접속 종료',exact:true}).click();await view.getByLabel('접속 비밀번호',{exact:true}).waitFor();assert.equal((await phone.request.get(remoteBase+'/__alkynes/data')).status(),401);assert.deepEqual(errors,[]);
  }finally{if(browser)await browser.close();if(remote){remote.closeAllConnections();await new Promise(r=>remote.close(r));}if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}await fs.rm(root,{recursive:true,force:true});}
});
