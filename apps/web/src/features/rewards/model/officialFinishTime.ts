/** Keep copied millisecond evidence exact, including values beyond Number's safe range. */
export function officialFinishTime(milliseconds:string|null,status:string){
 if(status!=='finished')return status==='standing'?'—':status.toUpperCase();
 if(milliseconds===null)return '—';
 const ms=BigInt(milliseconds),seconds=ms/1000n;
 return [seconds/3600n,seconds/60n%60n,seconds%60n].map(v=>v.toString().padStart(2,'0')).join(':')+'.'+(ms%1000n).toString().padStart(3,'0');
}
