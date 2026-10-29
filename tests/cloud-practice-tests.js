const out=document.getElementById('results'), summary=document.getElementById('summary'), mount=document.getElementById('test-mount');
const base='./fixtures/11-cultural-language-cloud/';
const project=WebPreview.adaptProject(await (await fetch(base+'Screen1.scm')).text(),await (await fetch(base+'Screen1.bky')).text());
let passed=0, failed=0;
async function test(name, f) { const li=document.createElement('li');try{await f();li.textContent='PASS '+name;passed++;}catch(e){li.textContent='FAIL '+name+': '+e.message;failed++;}out.append(li);summary.textContent=`${passed} passed, ${failed} failed`; }
function assert(v,m) {if(!v)throw new Error(m);}
const errors=[], requests=[], storage={}, audio=[];
let saveFails=false, readFails=false;
const fakeRequest=async(url,method,body)=>{
 if(!WebPreview.allowedRequest(url,method))throw new Error('Request blocked by preview policy');
 requests.push({url,method,body});
 if(url.includes('signInWithPassword')) return {code:200,content:JSON.stringify({localId:body.includes('other@')?'learnerB':'learnerA',idToken:'test-token',refreshToken:'test-refresh',email:'test@example.invalid'})};
 if(url.includes('securetoken'))return {code:200,content:JSON.stringify({id_token:'new-token',refresh_token:'new-refresh',user_id:'learnerA'})};
 if(url.includes('/words'))return {code:200,content:'null'};
 if(method==='GET')return {code:readFails?503:200,content:'null'};
 return {code:saveFails?503:200,content:'true'};
};
const assets={};for(let i=1;i<=3;i++){const b=await(await fetch(base+`word${i}.wav`)).arrayBuffer();let s='';for(const n of new Uint8Array(b))s+=String.fromCharCode(n);assets[`word${i}.wav`]='data:audio/wav;base64,'+btoa(s);}
const runtime=WebPreview.createRuntime({document,mount,project:structuredClone(project),storage,assets,onError:e=>errors.push(e),request:fakeRequest,audioFactory:()=>({pause(){},play(){audio.push(this.src);return Promise.resolve();}})});
const props=n=>runtime.components.get(n).component.properties;
const click=n=>runtime.components.get(n).element.click();
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));};
await test('Complete model validates and all used blocks are recognized',()=>{
 WebPreview.validateRuntimeModel(project);
 const report=WebPreview.analyzeCompatibility(project);assert(!report.unsupported.length,report.unsupported.join(', '));
});
await test('Cloud progress read and best-score write are permitted by the real transport',()=>{
 assert(WebPreview.allowedRequest('https://languageapp-5e07a-default-rtdb.firebaseio.com/progress/learnerA.json?auth=test-token','GET'),'cloud progress read is blocked');
 assert(WebPreview.allowedRequest('https://languageapp-5e07a-default-rtdb.firebaseio.com/progress/learnerA/bestScore.json?auth=test-token','PUT'),'practice score save is blocked');
});
await test('Initialize opens sign-in and masks the password',()=>{assert(String(props('LoginPanel').Visible).toLowerCase()==='true' && String(props('AppPanel').Visible).toLowerCase()==='false','incorrect screen');assert(runtime.components.get('PasswordInput').element.type==='password','unmasked password');});
await test('Email sign-in loads words and own progress through actual blocks',async()=>{
 runtime.components.get('EmailInput').element.value='test@example.invalid';runtime.components.get('PasswordInput').element.value='not-a-real-password';click('SignInButton');await settle();
 assert(runtime.globals.get('ready'),'not ready: '+errors.join(';'));
 assert(props('WordLabel').Text==='Ju','word not loaded');assert(props('PasswordInput').Text==='','password not cleared');
 assert(!JSON.stringify(storage).includes('password') && !JSON.stringify(storage).includes('test-token'),'credentials stored');
});
await test('All three recordings and navigation limits use the model blocks',()=>{
 for(const [word,i] of [['Ju',1],['Nukro',2],['Minchi',3]]){assert(props('WordLabel').Text===word,'wrong word');click('ListenButton');assert(audio.at(-1)===assets[`word${i}.wav`],'wrong recording');click('NextButton');}
 assert(props('WordLabel').Text==='Minchi','passed last word');for(let i=0;i<3;i++)click('PreviousButton');assert(props('WordLabel').Text==='Ju','passed first word');
});
await test('Phone practice keeps every answer within the first 650 pixels',()=>{
 click('PracticeTab');
 const top=runtime.screenElement.getBoundingClientRect().top;
 const bottom=runtime.components.get('Answer3').element.getBoundingClientRect().bottom-top;
 assert(bottom<=650,`last answer ends at ${Math.round(bottom)}px`);
});
await test('Practice completes three questions with feedback, result and retry',async()=>{
 click('PracticeTab');
 for(let i=1;i<=3;i++){
  assert(String(props('QuestionCounter').Text).includes(String(i)),'question counter');
  click('QuizListenButton');
  assert(audio.at(-1)===assets[`word${[2,3,1][i-1]}.wav`],'wrong practice audio');
  click('Answer'+[2,3,1][i-1]);
  assert(runtime.globals.get('answered')===true,'answer did not run: '+errors.join('; '));
  assert(props('FeedbackLabel').Text,'feedback missing');
  click('QuizNextButton');
 }
 assert(runtime.globals.get('score')===3,'wrong practice score');
 assert(props('RestartQuizButton').Visible===true,'retry missing');
 await settle();
 click('RestartQuizButton');assert(runtime.globals.get('score')===0,'retry did not reset');click('LearnTab');for(let i=0;i<3;i++)click('PreviousButton');
});
await test('Mark learned saves an individual Firebase leaf and updates progress',async()=>{
 click('LearnedButton');await settle();assert(requests.some(r=>r.method==='PUT'&&r.url.includes('/progress/learnerA/learned/ju.json')),'wrong save path');
 click('ProgressTab');assert(props('LearnedSummary').Text==='1 / 3 words learned','wrong summary');assert(!runtime.globals.get('queue').length,'queue not drained');click('LearnTab');
});
await test('Failed saves remain pending and retry after re-login',async()=>{
 saveFails=true;click('NextButton');click('LearnedButton');await settle();assert(runtime.globals.get('queue').length===1,'pending save missing');
 saveFails=false;click('SignOutButton');runtime.components.get('EmailInput').element.value='test@example.invalid';runtime.components.get('PasswordInput').element.value='not-a-real-password';click('SignInButton');await settle();
 assert(!runtime.globals.get('queue').length,'retry did not drain');
});
await test('Different learner cannot inherit cached progress',async()=>{
 click('SignOutButton');runtime.components.get('EmailInput').element.value='other@example.invalid';runtime.components.get('PasswordInput').element.value='not-a-real-password';click('SignInButton');await settle();assert(!Object.keys(runtime.globals.get('learned')).length,'account data leaked');
});
await test('Sync now requests a token refresh',async()=>{click('RetrySyncButton');await settle();assert(requests.some(r=>r.url.includes('securetoken.googleapis.com')),'refresh missing');});
await test('Practice still answers and keeps its score locally after a progress-load failure',async()=>{
 readFails=true;click('RetrySyncButton');await settle();
 assert(runtime.globals.get('ready')===false,'failed-read scenario did not run');
 click('PracticeTab');click('RestartQuizButton');
 for(const answer of [2,3,1]){click('Answer'+answer);assert(runtime.globals.get('answered')===true,'answer silently ignored when sync fails');click('QuizNextButton');}
 assert(runtime.globals.get('score')===3,'offline practice score lost');
 assert(runtime.globals.get('queue').some(item=>item[0]==='bestScore'),'best score was not queued');
 readFails=false;click('RetrySyncButton');await settle();
 assert(!runtime.globals.get('queue').length,'score did not sync after recovery');
 click('LearnTab');
});
await test('Network policy rejects other databases, origins, redirects, protocols and paths',()=>{
 for(const u of ['http://languageapp-5e07a-default-rtdb.firebaseio.com/words.json','https://evil.example/words.json','https://other.firebaseio.com/words.json','https://languageapp-5e07a-default-rtdb.firebaseio.com/.json','https://languageapp-5e07a-default-rtdb.firebaseio.com/words.json#x','https://user:pass@languageapp-5e07a-default-rtdb.firebaseio.com/words.json'])assert(!WebPreview.allowedRequest(u,'GET'),'allowed '+u);
 assert(!WebPreview.allowedRequest('https://languageapp-5e07a-default-rtdb.firebaseio.com/words.json','PUT'),'word writes allowed');
 assert(!WebPreview.allowedRequest('https://languageapp-5e07a-default-rtdb.firebaseio.com/progress/learnerA.json','PUT'),'whole-account overwrite allowed');
 assert(!WebPreview.allowedRequest('https://other.firebaseio.com/progress/learnerA/bestScore.json','PUT'),'other project allowed');
});
await test('No runtime errors in the completed app flow',()=>assert(!errors.length,errors.join('; ')));
runtime.dispose();
await test('Real browser decodes all three original audio assets',async()=>{
 for(const src of Object.values(assets)){
  const player=new Audio();
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Audio metadata timed out')),3000);
   player.onloadedmetadata=()=>{clearTimeout(timeout);player.duration>0?resolve():reject(new Error('Empty recording'));};
   player.onerror=()=>{clearTimeout(timeout);reject(new Error('Audio decode failed'));};player.src=src;player.load();
  });player.src='';
 }
});
await test('Stored pending progress survives a new preview runtime',async()=>{
 readFails=false;const pending={};const r=WebPreview.createRuntime({document,mount,project:structuredClone(project),storage:pending,assets,request:async(u,m,b)=> m==='PUT'?{code:503,content:'{}'}:fakeRequest(u,m,b)});
 r.components.get('EmailInput').element.value='test@example.invalid';r.components.get('PasswordInput').element.value='not-a-real-password';r.fire('SignInButton','Click');await settle();r.fire('LearnedButton','Click');await settle();r.dispose();
 const restored=WebPreview.createRuntime({document,mount,project:structuredClone(project),storage:structuredClone(pending),assets,request:fakeRequest});
 restored.components.get('EmailInput').element.value='test@example.invalid';restored.components.get('PasswordInput').element.value='not-a-real-password';restored.fire('SignInButton','Click');await settle();
 assert(restored.globals.get('learned').ju===true,'learned state lost');assert(!restored.globals.get('queue').length,'pending state not retried');restored.dispose();
});
