'use client';
import { useEffect, useState } from 'react';
type Status = { enabled: boolean; connected: boolean; address: string; addresses: string[]; url: string; error: string; recovering?: boolean; recoveryMessage?: string };
export function MobileAccess() {
  const [status, setStatus] = useState<Status | null>(null), [address,setAddress]=useState(''), [password,setPassword]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  async function api(body?: object) {
    const response=await fetch('/__alkynes/mobile',{method:body?'POST':'GET',headers:{'X-Alkynes-Client':'1',...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw Error(value.error || '휴대폰 설정을 확인하지 못했습니다.');return value as Status;
  }
  useEffect(()=>{let active=true;const refresh=()=>void api().then(value=>{if(active){setStatus(value);setAddress(current=>current || value.address || value.addresses[0] || '');}}).catch(()=>{if(active)setError('앱 업데이트 후 노트북에서 설정할 수 있습니다.');});refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};},[]);
  async function save(enabled: boolean) {setBusy(true);setError('');try{setStatus(await api({enabled,address,password}));setPassword('');}catch(e){setError(e instanceof Error?e.message:'설정 저장 실패');}finally{setBusy(false);}}
  async function repair(){setBusy(true);setError('');try{setStatus(await api({action:'repair'}));}catch(e){setError(e instanceof Error?e.message:'연결 복구 실패');}finally{setBusy(false);}}
  return <section className="card space-y-4 p-6"><h2 className="font-bold">휴대폰 개인 접속</h2>
    <p className="text-sm text-slate-600">같은 Tailscale 계정으로 연결된 휴대폰에서 노트북 데이터를 조회합니다. 노트북 전원과 앱이 켜져 있어야 합니다. 기본은 꺼짐이며, 휴대폰에서는 수정·엑셀 연동·업데이트를 실행할 수 없습니다.</p>
    <p className="text-sm text-slate-500">Tailscale의 회사 업무용 무료 이용 가능 여부는 요금제·약관에서 별도로 확인해 주세요. 이 기능은 유료 요금제를 신청하지 않습니다.</p>
    {status && <><label className="block text-sm">노트북 Tailscale 주소<select className="field mt-2 max-w-md" value={address} onChange={e=>setAddress(e.target.value)}><option value="">VPN 연결 후 주소 선택</option>{[...new Set([...status.addresses,...(status.address?[status.address]:[])])].map(ip=><option key={ip}>{ip}</option>)}</select></label>
      <label className="block text-sm">접속 비밀번호 (12자 이상)<input className="field mt-2 max-w-md" type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="설정한 비밀번호는 휴대폰에 직접 입력하세요." /></label>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={busy || !address || (!status.enabled && password.length<12) || (!!password && password.length<12)} onClick={()=>void save(true)}>{status.enabled?'접속 설정 저장':'휴대폰 접속 켜기'}</button><button className="btn-secondary" disabled={busy || !status.enabled} onClick={()=>void save(false)}>접속 끄기</button></div>
      <button className="btn-secondary" disabled={busy || status.recovering} onClick={()=>void repair()}>이전 서버 정리 · 연결 복구</button>
      {status.recoveryMessage && <p role="status" className="text-sm">{status.recoveryMessage}</p>}
      <p role="status">{status.recovering?'이전 모바일 서버 정리 중':status.connected?'접속 가능':status.enabled?'VPN 연결 대기 중':'휴대폰 접속 꺼짐'}</p>
      {status.url && <div className="rounded-lg border p-3"><p className="text-sm">휴대폰의 Tailscale을 켜고 브라우저에 아래 주소를 입력하세요.</p><p className="mt-2 break-all font-bold select-all">{status.url}</p></div>}
      {status.error && <p role="alert" className="text-sm text-amber-800">{status.error}</p>}</>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
