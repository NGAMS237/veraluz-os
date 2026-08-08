import fs from 'fs'; import vm from 'vm';
const src = fs.readFileSync(new URL('../CONTACTS_EMBEDDED.html', import.meta.url),'utf8');
const js = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');

let pass=0, fail=0;
const t=(n,c)=>{ try{ if(c()){console.log('  PASS '+n);pass++;} else {console.log('  FAIL '+n);fail++;} }
                 catch(e){ console.log('  FAIL '+n+' — '+e.message); fail++; } };

const cacheA = [
  {id:1, client_name:'Awa Ngo',  client_email:'AWA@x.cm', client_phone:'690', total:'15000', check_in:'2026-01-10'},
  {id:2, client_name:'Awa Ngo',  client_email:'awa@x.cm', client_phone:'690', total:'5000',  check_in:'2026-03-02'},
  {id:3, client_name:'Bea Sila', client_email:'bea@x.cm', client_phone:'691', total:'8000',  check_in:'2026-02-01'},
];
const cacheB = cacheA.map(r=>({...r, guest_name:r.client_name, guest_email:r.client_email,
                               guest_phone:r.client_phone, total:Number(r.total)}));

function mkEl(){ const e={ innerHTML:'', innerText:'', textContent:'', value:'', checked:false,
    style:{}, dataset:{}, children:[], classList:{add(){},remove(){},toggle(){},contains:()=>false},
    addEventListener(){}, removeEventListener(){}, appendChild(){}, setAttribute(){},
    getAttribute:()=>null, remove(){}, focus(){}, click(){},
    querySelector:()=>mkEl(), querySelectorAll:()=>[] }; return e; }

function run(cache){
  const store={ vlz_cache_rez: JSON.stringify(cache) };
  const ctx={
    console, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Promise,
    parseFloat, parseInt, isNaN, encodeURIComponent, decodeURIComponent, Set, Map,
    setTimeout:(f)=>{ return 0; }, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
    localStorage:{ getItem:k=>(k in store?store[k]:null), setItem(k,v){store[k]=String(v)},
                   removeItem(k){delete store[k]}, clear(){} },
    fetch: () => Promise.reject(new Error('offline')),   // isole strictement la branche cache
    document:{ getElementById:()=>mkEl(), querySelector:()=>mkEl(), querySelectorAll:()=>[],
               createElement:()=>mkEl(), addEventListener(){}, removeEventListener(){},
               body:mkEl(), documentElement:mkEl(), readyState:'complete' },
    location:{href:'',search:'',hash:''}, navigator:{userAgent:'node',onLine:false},
    alert(){}, confirm:()=>true, prompt:()=>null, addEventListener(){}, removeEventListener(){},
    postMessage(){}, parent:null, matchMedia:()=>({matches:false,addEventListener(){}}),
  };
  ctx.window=ctx; ctx.globalThis=ctx; ctx.self=ctx; ctx.parent=ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx, {timeout:15000});
  return ctx;
}

const results={};
for (const [label, cache] of [['A (client_* bruts — ecrit par PAIEMENTS)',cacheA],
                              ['B (avec alias guest_* — ecrit par RESERVATIONS)',cacheB]]) {
  console.log('\n── Cache forme ' + label);
  let ctx, ok=true;
  t('RT-01 script evalue, loadAll definie', ()=>{ ctx=run(cache); return typeof ctx.loadAll==='function'; });
  if(!ctx){ fail+=7; continue; }
  await ctx.loadAll().catch(e=>{ console.log('  (loadAll a rejete: '+e.message+')'); });
  const c = () => (ctx.contacts||[]).filter(x=>x.type==='client');
  t('RT-02 loadAll() termine sans exception', ()=> Array.isArray(ctx.contacts));
  t('RT-03 2 clients distincts extraits du cache', ()=> c().length===2);
  t('RT-04 dedup email insensible a la casse (AWA@/awa@ -> 1, count=2)', ()=>{
      const a=c().filter(x=>x.email==='awa@x.cm'); return a.length===1 && a[0].count===2; });
  t('RT-05 total cumule = 20000  [regression total_price -> total]', ()=>
      Number(c().find(x=>x.email==='awa@x.cm').total)===20000);
  t('RT-06 nom resolu, pas de repli sur email', ()=> c().find(x=>x.email==='awa@x.cm').name==='Awa Ngo');
  t('RT-07 telephone resolu', ()=> c().find(x=>x.email==='awa@x.cm').phone==='690');
  t('RT-08 lastDate = sejour le plus recent', ()=> c().find(x=>x.email==='awa@x.cm').lastDate==='2026-03-02');
}
console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass+fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail?1:0);
