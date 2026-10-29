(function (W) {
const { LIMITS, applyProperty, readProperty, renderScreen } = W;

// The browser preview is deliberately restricted to the classroom project's REST services.
function allowedRequest(raw, method) {
  let u; try {u = new URL(raw);} catch {return false;}
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port) return false;
  if (u.hostname === 'identitytoolkit.googleapis.com')
    return method === 'POST' && /^\/v1\/accounts:(signInWithPassword|signUp|sendOobCode)$/.test(u.pathname);
  if (u.hostname === 'securetoken.googleapis.com') return method === 'POST' && u.pathname === '/v1/token';
  if (u.hostname === 'languageapp-5e07a-default-rtdb.firebaseio.com')
    return method === 'GET' && /^\/(words|progress\/[A-Za-z0-9_-]{1,128}(?:\/learned)?)\.json$/.test(u.pathname) ||
      method === 'PUT' && /^\/progress\/[A-Za-z0-9_-]{1,128}\/(?:bestScore|learned\/[A-Za-z0-9_-]{1,128})\.json$/.test(u.pathname);
  return false;
}
async function firebaseRequest(url, method, body, headers, timeout) {
  if (!allowedRequest(url, method)) throw new Error('Web Preview blocked a URL outside the classroom Firebase services.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(timeout) || 15000, 30000)));
  try {
    if (String(body || '').length > 100000) throw new Error('Request is too large.');
    const h = new Headers();
    for (const pair of headers || []) {
      if (!Array.isArray(pair) || pair.length !== 2 || String(pair[0]).toLowerCase() !== 'content-type')
        throw new Error('Only Content-Type headers are supported in this preview.');
      h.set(pair[0], pair[1]);
    }
    const response = await fetch(url, {method, headers:h, body:method === 'GET' ? undefined : String(body),
      credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', signal:controller.signal});
    const reader = response.body.getReader();
    let length = 0, content = ''; const decoder = new TextDecoder();
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1000000) { await reader.cancel(); throw new Error('Response is too large.'); }
      content += decoder.decode(value, {stream:true});
    }
    content += decoder.decode();
    return {code:response.status, type:response.headers.get('content-type') || '', content};
  } finally { clearTimeout(timer); }
}

function createRuntime({document, mount, project, onError = () => {}, request = firebaseRequest,
    storage = Object.create(null), onStore = () => {}, assets = Object.create(null), audioFactory = () => new Audio()}) {
  const rendered = renderScreen(document, mount, project);
  const components = rendered.components, globals = new Map(), handlers = new Map();
  const procedures = new Map((project.program.procedures || []).map(p => [p.fields.NAME, p]));
  const timers = new Map(), players = new Map();
  let disposed = false, pendingRequests = 0, requestCount = 0;
  const budget = () => ({steps:0, calls:0});
  const spend = b => { if (++b.steps > LIMITS.executionSteps) throw new Error('Web Preview stopped this event after its instruction limit.'); };
  const own = (o,k) => o != null && Object.hasOwn(o,String(k));
  const list = v => { if (!Array.isArray(v)) throw new Error('Expected a list.'); return v; };
  const index = (a, n) => { const i=Number(n)-1; if (!Number.isInteger(i) || i<0 || i>=a.length) throw new Error('List index is outside the list.'); return i; };
  const component = n => { const c=components.get(n); if (!c) throw new Error(`Component ${n} is missing.`); return c; };
  const text = v => v === null ? 'null' : typeof v === 'boolean' ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  function runStatements(body, locals, b) { for (const s of body) evaluate(s,locals,b,0); }
  function evaluate(e, locals, b, depth) {
    spend(b); if (depth > LIMITS.expressionDepth) throw new Error('Expression is too deeply nested.');
    const ev = v => evaluate(v,locals,b,depth+1);
    switch(e.kind) {
      case 'literal':return e.value;
      case 'getGlobal': if (!globals.has(e.name)) throw new Error(`Global ${e.name} is missing.`); return globals.get(e.name);
      case 'setGlobal': if (!globals.has(e.name)) throw new Error(`Global ${e.name} is missing.`); globals.set(e.name,ev(e.value)); return;
      case 'getLocal': if (!(e.name in locals)) throw new Error(`Variable ${e.name} is missing.`); return locals[e.name];
      case 'setLocal': if (!(e.name in locals)) throw new Error(`Variable ${e.name} is missing.`); locals[e.name]=ev(e.value); return;
      case 'getProperty':return readProperty(component(e.component),e.property);
      case 'setProperty': {
        const c=component(e.component); applyProperty(c,e.property,ev(e.value));
        if (c.component.type==='Clock') updateTimer(e.component); return;
      }
      case 'joinText':return e.values.map(v=>text(ev(v))).join('');
      case 'unsupported':throw new Error(`Unsupported block ${e.blockType}.`);
      case 'block':break;
      default:throw new Error(`Unsupported operation ${e.kind}.`);
    }
    const val = n => { if (!e.values[n]) throw new Error(`Missing ${e.type}.${n}.`); return ev(e.values[n]); };
    const vals = () => Object.values(e.values).map(ev);
    const body = n => runStatements(e.bodies[n] || [],locals,b);
    switch(e.type) {
      case 'lists_create_with': return vals();
      case 'pair':return [val('KEY'),val('VALUE')];
      case 'dictionaries_create_with':return Object.fromEntries(vals());
      case 'dictionaries_lookup': { const d=val('DICT'), k=val('KEY'); return own(d,k) ? d[k] : val('NOTFOUND'); }
      case 'dictionaries_set_pair': { const d=val('DICT'); if (!d || Array.isArray(d) || typeof d!=='object') throw new Error('Expected dictionary.'); Object.defineProperty(d,String(val('KEY')),{value:val('VALUE'),writable:true,enumerable:true,configurable:true}); return; }
      case 'lists_select_item': { const a=list(val('LIST')); return a[index(a,val('NUM'))]; }
      case 'lists_length':return list(val('LIST')).length;
      case 'lists_is_list':return Array.isArray(val('ITEM'));
      case 'lists_add_items': { const a=list(val('LIST')); if (a.length>=2000) throw new Error('List is too large.'); for (const k of Object.keys(e.values).filter(k=>k.startsWith('ITEM'))) a.push(val(k)); return; }
      case 'lists_remove_item': { const a=list(val('LIST')); a.splice(index(a,val('INDEX')),1); return; }
      case 'lists_replace_item': { const a=list(val('LIST')); a[index(a,val('NUM'))]=val('ITEM'); return; }
      case 'text_trim':return text(val('TEXT')).trim();
      case 'logic_compare':return e.fields.OP==='NEQ' ? val('A')!==val('B') : val('A')===val('B');
      case 'logic_operation':return e.fields.OP==='OR' ? Boolean(val('A') || val('B')) : Boolean(val('A') && val('B'));
      case 'logic_negate':return !val('BOOL');
      case 'math_compare': { const a=val('A'),c=val('B'); return {GT:a>c,GTE:a>=c,LT:a<c,LTE:a<=c,EQ:a===c,NEQ:a!==c}[e.fields.OP]; }
      case 'math_add':return vals().reduce((a,c)=>a+Number(c),0);
      case 'math_subtract':return Number(val('A'))-Number(val('B'));
      case 'controls_choose':return val(val('TEST') ? 'THENRETURN' : 'ELSERETURN');
      case 'controls_if': { for (let i=0;e.values[`IF${i}`];i++) if (val(`IF${i}`)) { body(`DO${i}`); return; } body('ELSE'); return; }
      case 'controls_forEach': {
        for (const item of [...list(val('LIST'))]) { spend(b); const scope=Object.create(locals); scope[e.fields.VAR]=item; runStatements(e.bodies.DO || [],scope,b); } return;
      }
      case 'procedures_callnoreturn': {
        const p=procedures.get(e.fields.PROCNAME); if (!p) throw new Error(`Procedure ${e.fields.PROCNAME} is missing.`);
        if (++b.calls>50) throw new Error('Procedure call limit reached.');
        const scope=Object.create(null); (p.args || []).forEach((n,i)=>scope[n]=val(`ARG${i}`));
        try {runStatements(p.bodies.STACK || [],scope,b);} finally { b.calls--; } return;
      }
      case 'component_component_block':return e.mutation.instance_name;
      case 'component_method':return method(e.mutation.instance_name,e.mutation.method_name,vals());
      default:throw new Error(`Unsupported block ${e.type}.`);
    }
  }
  function fire(name,event,args={}) {
    if (disposed) return;
    try { const b=budget(); for (const h of handlers.get(`${name}.${event}`) || []) runStatements(h.body,Object.assign(Object.create(null),args),b); }
    catch (e) { onError(e.message || 'Preview event failed.'); }
  }
  function method(name,m,a) {
    const c=component(name), p=c.component.properties;
    if (!c.adapter.methods?.has(m)) throw new Error(`Unsupported method ${name}.${m}.`);
    switch(c.component.type) {
      case 'Web':
        if (m==='JsonObjectEncode') return JSON.stringify(a[0]);
        if (m==='JsonTextDecodeWithDictionaries') return JSON.parse(a[0]);
        {
          if (pendingRequests >= 8 || ++requestCount > 300) throw new Error('Preview request limit reached. Reopen Web Preview to start a new test.');
          pendingRequests++;
          const url=String(p.Url || ''), verb={Get:'GET',PostText:'POST',PutText:'PUT'}[m];
          Promise.resolve().then(()=>request(url,verb,a[0],structuredClone(p.RequestHeaders || []),p.Timeout)).then(r=>{
            fire(name,'GotText',{url,responseCode:r.code,responseType:r.type,responseContent:r.content});
          }).catch(()=>{
            if (disposed) return;
            fire(name,'TimedOut',{url});
            fire(project.screen.name,'ErrorOccurred',{component:name,functionName:m,errorNumber:1101,message:'Web request failed or was blocked by preview policy.'});
          }).finally(()=>{pendingRequests--;}); return;
        }
      case 'TinyDB': {
        const key=JSON.stringify([String(p.Namespace || 'TinyDB'),String(a[0])]);
        if (m==='GetValue') return structuredClone(own(storage,key) ? storage[key] : a[1]);
        const value=structuredClone(a[1]);
        if (JSON.stringify(value).length>100000) throw new Error('Stored value is too large.');
        Object.defineProperty(storage,key,{value,writable:true,enumerable:true,configurable:true}); onStore(structuredClone(storage)); return;
      }
      case 'Player': {
        let player=players.get(name); if (!player) { player=audioFactory(); players.set(name,player); }
        if (m==='Stop') {player.pause(); player.currentTime=0;return;}
        const source=String(p.Source || '');
        if (!Object.hasOwn(assets,source) || !/^data:audio\/(wav|mpeg|ogg);base64,[A-Za-z0-9+/=]+$/.test(assets[source])) throw new Error(`Recording ${source} is missing. Import the .aia with its recordings.`);
        player.src=assets[source]; player.volume=Math.max(0,Math.min(1,Number(p.Volume ?? 100)/100));
        player.play().catch(()=>onError('The browser could not play this recording. Tap Listen again.')); return;
      }
    }
  }
  function updateTimer(name) {
    clearInterval(timers.get(name)); timers.delete(name);
    const c=component(name), enabled=readProperty(c,'TimerEnabled');
    if (enabled===true || enabled==='True') timers.set(name,setInterval(()=>fire(name,'Timer'),Math.max(100,Math.min(3600000,Number(readProperty(c,'TimerInterval')) || 1000))));
  }
  const initializationBudget = budget();
  for (const d of project.program.globals) globals.set(d.name,evaluate(d.value,Object.create(null),initializationBudget,0));
  for (const e of project.program.events) {
    const c=components.get(e.component); if (!c?.adapter.events.has(e.event)) continue;
    const key=`${e.component}.${e.event}`; handlers.set(key,[...(handlers.get(key)||[]),e]);
  }
  for (const [name,c] of components) {
    if (c.adapter.events.has('Click')) c.element.addEventListener('click',()=>fire(name,'Click'));
    if (c.component.type==='Clock') updateTimer(name);
  }
  fire(project.screen.name,'Initialize');
  return {...rendered, globals, fire,
    dispose() {disposed=true;for(const t of timers.values())clearInterval(t);for(const p of players.values())p.pause();},
    restart() {this.dispose();return createRuntime({document,mount,project:structuredClone(project),onError,request,storage,onStore,assets,audioFactory});}
  };
}
Object.assign(W,{createRuntime,allowedRequest,firebaseRequest});
})(globalThis.WebPreview ||= {});
