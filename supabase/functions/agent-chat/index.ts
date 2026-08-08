/**
 * agent-chat v8 — conversation persistence + list/load/update actions
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://joegfxwcsvtqtxbffpkp.supabase.co',
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000','http://localhost:8080'
];
const CHAT_PERMISSIONS: Record<string,string[]> = {
  chloe_director_v1:    ['gerant','admin','superadmin'],
  maya_restaurant_v1:   ['gerant','admin','superadmin','barman'],
  nora_reservations_v1: ['gerant','admin','superadmin','receptionniste'],
  techops_v1:           ['gerant','admin','superadmin','technicien'],
  sonia_hr_v1:          ['gerant','admin','superadmin'],
  lexa_legal_v1:        ['gerant','admin','superadmin'],
  finance_v1:           ['gerant','admin','superadmin'],
  commercial_v1:        ['gerant','admin','superadmin','receptionniste'],
  maintenance_v1:       ['gerant','admin','superadmin','technicien'],
  security_v1:          ['gerant','admin','superadmin'],
};
const FOLLOWUP=/^(liste|d[ée]tail|pr[ée]cise|donne.{0,5}(moi|la)|montre|affiche|quels sont|qui sont|combien|liste.{0,4}moi|en liste|sous forme)/i;

function corsHeaders(o:string){const a=ALLOWED_ORIGINS.includes(o)?o:ALLOWED_ORIGINS[0];return{'Access-Control-Allow-Origin':a,'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-veraluz-session,x-internal-secret','Access-Control-Allow-Methods':'POST,OPTIONS'};}
async function hashToken(t:string):Promise<string>{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}

async function validateSession(admin:ReturnType<typeof createClient>,token:string):Promise<{employee_id:string;role:string}|null>{
  const h=await hashToken(token);
  const now=new Date().toISOString();
  const{data:s}=await admin.from('veraluz_employee_sessions').select('employee_id').eq('token_hash',h).is('revoked_at',null).gt('expires_at',now).single();
  if(!s)return null;
  const{data:e}=await admin.from('veraluz_employees').select('role').eq('id',s.employee_id).single();
  return{employee_id:s.employee_id,role:e?.role||'staff'};
}

async function loadCtx(admin:ReturnType<typeof createClient>,cid:string):Promise<{last_intent:string|null}>{
  try{
    const{data:m}=await admin.from('veraluz_agent_messages').select('role,tools_used').eq('conversation_id',cid).order('created_at',{ascending:false}).limit(6);
    const la=m?.find((x:any)=>x.role==='assistant');
    return{last_intent:la?.tools_used?.[0]||null};
  }catch{return{last_intent:null};}
}

function isFollowUp(msg:string){return msg.trim().length<80&&FOLLOWUP.test(msg.trim());}

function detectIntent(msg:string,agentKey:string,last:string|null):string{
  const m=msg.toLowerCase();
  if(isFollowUp(msg)&&last&&!last.endsWith('_list'))return last+'_list';
  if(agentKey==='sonia_hr_v1'){
    if(/employ|staff|personnel|liste|qui/.test(m))return'hr_employees';
    if(/paie|salaire/.test(m))return'hr_payroll';
    if(/contrat/.test(m))return'hr_contracts';
  }
  if(agentKey==='finance_v1'){if(/revenu|chiffre|encaiss|paiement|finance/.test(m))return'finance_revenue';}
  if(agentKey==='nora_reservations_v1'||agentKey==='commercial_v1'){
    if(/reservat|r.servat|booking|client/.test(m))return'reservations';
    if(/occupat|taux/.test(m))return'occupancy';
    if(/arriv|depart|d.part/.test(m))return'arrivals_departures';
    return'reservations';
  }
  if(agentKey==='security_v1'||agentKey==='techops_v1')return'auth_events';
  if(agentKey==='maintenance_v1')return'units';
  if(agentKey==='lexa_legal_v1')return'contracts';
  if(agentKey==='maya_restaurant_v1')return'restaurant';
  return'general_status';
}

async function fetchData(admin:any,intent:string):Promise<{data:any,sources:string[]}>{
  const src:string[]=[];const sl=(a:any[]|null|undefined)=>a!=null?a.length:null;
  const ss=(a:any[]|null|undefined,f:string)=>a!=null?a.reduce((s:number,x:any)=>s+(Number(x[f])||0),0):null;
  const base=intent.endsWith('_list')?intent.replace('_list',''):intent;
  const asList=intent.endsWith('_list');
  try{
    if(base==='hr_employees'){
      const{data:e,error}=await admin.from('veraluz_employees').select('id,full_name,role,status').limit(100);
      if(error)return{data:{_intent:intent,error:error.message},sources:src};
      src.push('veraluz_employees');
      const act=e?.filter((x:any)=>x.status==='actif'||x.status==='active')||[];
      const roles:Record<string,number>={};e?.forEach((x:any)=>{roles[x.role]=(roles[x.role]||0)+1;});
      if(asList)return{data:{_intent:'hr_employees_list',employees:act.slice(0,20).map((x:any)=>({name:x.full_name||'(inconnu)',role:x.role})),total_active:act.length},sources:src};
      return{data:{_intent:'hr_employees',active:act.length,total:sl(e),roles},sources:src};
    }
    if(base==='finance_revenue'){
      const{data:p,error}=await admin.from('veraluz_payments').select('id,amount,status').limit(200);
      if(error)return{data:{_intent:intent,error:error.message},sources:src};
      src.push('veraluz_payments');
      const val=p?.filter((x:any)=>x.status==='validated'||x.status==='paid')||[];
      const pend=p?.filter((x:any)=>x.status==='pending')||[];
      return{data:{_intent:'finance_revenue',total_validated:ss(val,'amount'),count_validated:val.length,total_pending:ss(pend,'amount'),count_pending:pend.length},sources:src};
    }
    if(base==='reservations'||base==='occupancy'||base==='arrivals_departures'){
      const today=new Date().toISOString().split('T')[0];
      const{data:r}=await admin.from('veraluz_reservations').select('id,status,check_in,check_out').limit(200);
      const{data:u}=await admin.from('veraluz_units').select('id,status').limit(50);
      src.push('veraluz_reservations','veraluz_units');
      const tu=sl(u)||1;const occ=u?.filter((x:any)=>x.status==='occupied'||x.status==='occupe').length??null;
      return{data:{_intent:'reservations',active:r?.filter((x:any)=>x.status==='active'||x.status==='confirmed').length??null,arrivals_today:r?.filter((x:any)=>x.check_in===today).length??null,departures_today:r?.filter((x:any)=>x.check_out===today).length??null,occupancy_pct:occ!==null?Math.round((occ/tu)*100):null},sources:src};
    }
    if(base==='auth_events'){
      const cut=new Date(Date.now()-86400000).toISOString();
      const{data:ev}=await admin.from('veraluz_auth_events').select('id,event_type').gte('created_at',cut).limit(200);
      const{data:ss2}=await admin.from('veraluz_employee_sessions').select('id').is('revoked_at',null).gt('expires_at',new Date().toISOString()).limit(100);
      src.push('veraluz_auth_events','veraluz_employee_sessions');
      return{data:{_intent:'auth_events',events_24h:sl(ev),failed_24h:ev?.filter((x:any)=>x.event_type==='pin_failed').length??null,active_sessions:sl(ss2)},sources:src};
    }
    if(base==='units'){
      const{data:u}=await admin.from('veraluz_units').select('id,name,status').limit(50);
      src.push('veraluz_units');
      return{data:{_intent:'units',total:sl(u),out_of_service:u?.filter((x:any)=>x.status==='out_of_service').length??null,available:u?.filter((x:any)=>x.status==='available'||x.status==='disponible').length??null},sources:src};
    }
    if(base==='contracts'){src.push('veraluz_contracts');return{data:{_intent:'contracts',note:'Table veraluz_contracts non disponible dans cette phase.'},sources:src};}
    if(base==='restaurant'){
      const today=new Date().toISOString().split('T')[0];
      const{data:o}=await admin.from('veraluz_restaurant_orders').select('id,status,total_amount').gte('created_at',today+'T00:00:00').limit(100);
      src.push('veraluz_restaurant_orders');
      const done=o?.filter((x:any)=>x.status==='completed'||x.status==='delivered')||[];
      const pend=o?.filter((x:any)=>x.status==='pending'||x.status==='preparing')||[];
      return{data:{_intent:'restaurant',commandes_today:sl(o),en_cours:pend.length,terminees:done.length,revenu_today:ss(done,'total_amount')},sources:src};
    }
    const{data:e}=await admin.from('veraluz_employees').select('id,status').limit(200);
    const{data:r}=await admin.from('veraluz_reservations').select('id,status').limit(200);
    const{data:p}=await admin.from('veraluz_payments').select('id,amount,status').limit(200);
    src.push('veraluz_employees','veraluz_reservations','veraluz_payments');
    const ae=e?.filter((x:any)=>x.status==='actif'||x.status==='active')||[];
    const ar=r?.filter((x:any)=>x.status==='active'||x.status==='confirmed')||[];
    const vp=p?.filter((x:any)=>x.status==='validated'||x.status==='paid')||[];
    return{data:{_intent:'general_status',employes_actifs:ae.length,total_employes:sl(e),reservations_actives:ar.length,total_reservations:sl(r),revenu_valide_xaf:ss(vp,'amount')},sources:src};
  }catch(e:any){return{data:{_intent:intent,error:e.message},sources:src};}
}

function sv(v:any,fb='—'){return(v===null||v===undefined)?fb:String(v);}

function buildResp(agentKey:string,td:any,opMode:string):string{
  const N:Record<string,string>={chloe_director_v1:'Chloé',maya_restaurant_v1:'Maya',nora_reservations_v1:'Nora',techops_v1:'TechOps',sonia_hr_v1:'Sonia',lexa_legal_v1:'Lexa',finance_v1:'Finance',commercial_v1:'Commercial',maintenance_v1:'Maintenance',security_v1:'Sécurité'};
  const name=N[agentKey]||agentKey;const sim=opMode==='construction_simulation'?'[SIM] ':'';const d=td.data;
  if(d.error)return`${sim}**${name}** — Source indisponible : ${d.error}`;
  let r=`${sim}**${name}** — Analyse\n\n`;
  switch(d._intent){
    case'hr_employees':r+=`👥 Employés actifs : **${sv(d.active)}** / ${sv(d.total)} total\n`;if(d.roles){r+='Répartition :\n';for(const[k,v]of Object.entries(d.roles))r+=`  • ${k} : ${v}\n`;}r+=`\nℹ️ *Demandez « donne-moi la liste » pour les noms.*`;break;
    case'hr_employees_list':r=`${sim}**${name}** — Liste employés actifs\n\n`;if(!d.employees?.length){r+='Aucun employé actif.';break;}r+=`**${sv(d.total_active)} employé(s) :**\n\n`;d.employees.forEach((e:any,i:number)=>{r+=`${i+1}. **${sv(e.name)}** — ${sv(e.role)}\n`;});break;
    case'finance_revenue':r+=`💰 Validés : **${sv(d.total_validated!==null?Number(d.total_validated).toLocaleString():null)} XAF** (${sv(d.count_validated)} paiements)\n⏳ En attente : ${sv(d.total_pending!==null?Number(d.total_pending).toLocaleString():null)} XAF (${sv(d.count_pending)})\n`;break;
    case'reservations':r+=`🏨 Actives : **${sv(d.active)}** | Arrivées : ${sv(d.arrivals_today)} | Départs : ${sv(d.departures_today)}\n📊 Occupation : ${sv(d.occupancy_pct!==null?d.occupancy_pct+'%':null)}\n`;break;
    case'auth_events':r+=`🔐 Événements 24h : ${sv(d.events_24h)} | PIN échoués : ${sv(d.failed_24h)}\n🔑 Sessions actives : ${sv(d.active_sessions)}\n`;break;
    case'units':r+=`🏠 Units : ${sv(d.total)} total | Disponibles : ${sv(d.available)} | Hors service : ${sv(d.out_of_service)}\n`;break;
    case'contracts':r+=d.note||`📄 Contrats disponibles.\n`;break;
    case'restaurant':r+=`🍽️ Commandes : ${sv(d.commandes_today)} | En cours : ${sv(d.en_cours)} | Terminées : ${sv(d.terminees)}\n💰 Revenu : ${sv(d.revenu_today!==null?Number(d.revenu_today).toLocaleString():null)} XAF\n`;break;
    default:r+=`👥 Employés actifs : **${sv(d.employes_actifs)}** / ${sv(d.total_employes)} total\n🏨 Réservations actives : **${sv(d.reservations_actives)}** / ${sv(d.total_reservations)} total\n💰 Revenus validés : **${sv(d.revenu_valide_xaf!==null?Number(d.revenu_valide_xaf).toLocaleString():null)} XAF**\n`;break;
  }
  if(td.sources.length>0)r+=`\n*Sources : ${td.sources.join(', ')}*`;
  if(opMode==='construction_simulation')r+=`\n\n⚠️ *Mode construction — données réelles de la base*`;
  return r;
}

Deno.serve(async(req:Request)=>{
  const org=req.headers.get('origin')||'';
  const h=corsHeaders(org);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});
  const SB_URL=Deno.env.get('SUPABASE_URL')!;
  const SB_SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin=createClient(SB_URL,SB_SRV);
  const t0=Date.now();
  try{
    const body=await req.json();
    const{action,agent_key,message,conversation_id,session_token,history,title,status:newStatus}=body;

    // ── Validation session ──────────────────────────────────────────────────
    if(!session_token)return new Response(JSON.stringify({error:'session_token required'}),{status:401,headers:{...h,'Content-Type':'application/json'}});
    const emp=await validateSession(admin,session_token);
    if(!emp)return new Response(JSON.stringify({error:'invalid_session'}),{status:401,headers:{...h,'Content-Type':'application/json'}});

    // ── ACTION : list_conversations ─────────────────────────────────────────
    if(action==='list_conversations'){
      const{data:convs}=await admin
        .from('veraluz_agent_conversations')
        .select('id,agent_key,title,message_count,last_message_at,created_at,updated_at,status')
        .eq('username',emp.employee_id)
        .neq('status','archived')
        .order('updated_at',{ascending:false})
        .limit(50);
      return new Response(JSON.stringify({conversations:convs||[]}),{status:200,headers:{...h,'Content-Type':'application/json'}});
    }

    // ── ACTION : load_conversation ──────────────────────────────────────────
    if(action==='load_conversation'&&conversation_id){
      const{data:conv}=await admin
        .from('veraluz_agent_conversations')
        .select('id,agent_key,title,message_count,status,username')
        .eq('id',conversation_id)
        .single();
      if(!conv||conv.username!==emp.employee_id)
        return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{...h,'Content-Type':'application/json'}});
      const{data:msgs}=await admin
        .from('veraluz_agent_messages')
        .select('id,role,content,created_at,tools_used,sources,intent')
        .eq('conversation_id',conversation_id)
        .order('created_at',{ascending:true})
        .limit(100);
      return new Response(JSON.stringify({conversation:conv,messages:msgs||[]}),{status:200,headers:{...h,'Content-Type':'application/json'}});
    }

    // ── ACTION : update_conversation (rename / archive) ─────────────────────
    if(action==='update_conversation'&&conversation_id){
      const{data:conv}=await admin.from('veraluz_agent_conversations').select('username').eq('id',conversation_id).single();
      if(!conv||conv.username!==emp.employee_id)
        return new Response(JSON.stringify({error:'not_found'}),{status:404,headers:{...h,'Content-Type':'application/json'}});
      const upd:Record<string,any>={updated_at:new Date().toISOString()};
      if(title)upd.title=String(title).slice(0,120);
      if(newStatus&&['active','archived'].includes(newStatus))upd.status=newStatus;
      await admin.from('veraluz_agent_conversations').update(upd).eq('id',conversation_id);
      return new Response(JSON.stringify({ok:true}),{status:200,headers:{...h,'Content-Type':'application/json'}});
    }

    // ── ACTION : send (défaut) ──────────────────────────────────────────────
    if(!agent_key||!message)return new Response(JSON.stringify({error:'agent_key and message required'}),{status:400,headers:{...h,'Content-Type':'application/json'}});
    const perm=CHAT_PERMISSIONS[agent_key];
    if(!perm)return new Response(JSON.stringify({error:'agent_not_found'}),{status:404,headers:{...h,'Content-Type':'application/json'}});
    if(!perm.includes(emp.role))return new Response(JSON.stringify({error:'forbidden'}),{status:403,headers:{...h,'Content-Type':'application/json'}});

    const{data:cfg}=await admin.from('veraluz_operational_config').select('mode').order('changed_at',{ascending:false}).limit(1).single();
    const opMode=cfg?.mode||'construction_simulation';

    let ctx={last_intent:null as string|null};
    let cid:string|null=conversation_id||null;

    if(cid){
      ctx=await loadCtx(admin,cid);
    } else {
      // Créer nouvelle conversation
      const{data:nc}=await admin.from('veraluz_agent_conversations')
        .insert({agent_key,username:emp.employee_id,role:emp.role,title:message.slice(0,60),operational_mode:opMode,status:'active'})
        .select('id').single();
      cid=nc?.id||null;
    }

    const intent=detectIntent(message,agent_key,ctx.last_intent);
    const td=await fetchData(admin,intent);
    const content=buildResp(agent_key,td,opMode);

    if(cid){
      await admin.from('veraluz_agent_messages').insert({conversation_id:cid,role:'user',content:message,operational_mode:opMode,intent});
      await admin.from('veraluz_agent_messages').insert({conversation_id:cid,role:'assistant',content,tools_used:[intent],sources:td.sources.map((s:string)=>({table:s})),operational_mode:opMode,intent});
      const newCount=(history?.length||0)+2;
      await admin.from('veraluz_agent_conversations')
        .update({message_count:newCount,last_message_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq('id',cid);
    }

    await admin.from('veraluz_agent_usage_logs').insert({agent_key,conversation_id:cid,provider:'fallback',model:'keyword_intent_v8',input_tokens:Math.ceil(message.length/4),output_tokens:Math.ceil(content.length/4),latency_ms:Date.now()-t0,estimated_cost_usd:0,operational_mode:opMode});

    return new Response(JSON.stringify({
      conversation_id:cid,content,sources:td.sources,
      intent_detected:intent,
      follow_up_detected:isFollowUp(message)&&!!ctx.last_intent,
      llm_used:false,operational_mode:opMode,latency_ms:Date.now()-t0
    }),{status:200,headers:{...h,'Content-Type':'application/json'}});

  }catch(e:any){
    return new Response(JSON.stringify({error:'internal_error',message:e.message}),{status:500,headers:{...h,'Content-Type':'application/json'}});
  }
});
