// Share public chain observations only while the exact read is in flight. Each
// later recheck starts again, including chain/finality/nonce checks. This reader
// is used by status GETs only, never preparation, signatures or receipt writes.
const methods=new Set(['getChainId','getBlock','getTransaction','getTransactionReceipt','getCode','getStorageAt','getBalance','readContract']);
const readers=new WeakMap<object,object>();
export function clubStatusReader<T extends object>(reader:T):T{
 const existing=readers.get(reader);if(existing)return existing as T;
 const pending=new Map<string,Promise<unknown>>();
 const shared=new Proxy(reader,{get(target,name,receiver){
  const method=Reflect.get(target,name,receiver);
  if(typeof name!=='string'||!methods.has(name)||typeof method!=='function')return method;
  return (...args:unknown[])=>{
   const key=JSON.stringify([name,args],(_key,value)=>typeof value==='bigint'?{bigint:value.toString()}:value);
   const current=pending.get(key);if(current)return current;
   // Bound memory without delaying unrelated reads during a busy status page.
   if(pending.size>=512)return Reflect.apply(method,target,args);
   const request=Promise.resolve().then(()=>Reflect.apply(method,target,args)).finally(()=>pending.delete(key));
   pending.set(key,request);return request;
  };
 }});
 readers.set(reader,shared);return shared;
}
