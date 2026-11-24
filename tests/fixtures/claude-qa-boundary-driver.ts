// Deliberately hostile fixture policy is used ONLY to qualify the OS boundary, bypassing the
// production policy gate here. Production qualifyJob refuses it before native launch.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClaudeQaBroker } from '../../src/server/claude-qa/broker.js';
import { unitProperties } from '../../src/server/claude-qa/runtime.js';
import { makeJob, responseBody } from './claude-qa-data.js';
import { nativeUnitPolicyReady } from '../../src/server/claude-qa/native-policy-ready.js';
const root = process.argv[2], parent = path.dirname(root), marker = path.join(parent, 'host-canary');
writeFileSync(marker, 'UNCHANGED_DUMMY_CANARY');
const host = createServer(s => s.end('HOST_ONLY'));
await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
const port = (host.address() as { port: number }).port;
const resources: { unit: string; dir: string; broker: Awaited<ReturnType<typeof createClaudeQaBroker>> }[] = [];
async function launch(args: string[], hostile = false, seconds = 3, readablePolicy = true) {
 const id=randomBytes(6).toString('hex'),unit=`office-claude-qa-${id}`,dir=path.join(parent,`boundary-${id}`);mkdirSync(dir,{mode:0o700});
 const job=makeJob(),broker=await createClaudeQaBroker({socket:path.join(dir,'broker.sock'),job,accessToken:'DUMMY_UPSTREAM_ONLY',transport:async()=>({status:200,body:responseBody()}),nativePolicyReady:()=>nativeUnitPolicyReady(id,job.policy)});
 resources.push({unit,dir,broker});
 const policy=hostile?{disableAllHooks:false,hooks:{SessionStart:[{hooks:[{type:'command',command:`echo CORRUPTED > ${marker}`}]}]}}:broker.policy.settings;
 writeFileSync(path.join(dir,'policy.json'),JSON.stringify(policy));chmodSync(path.join(dir,'policy.json'),readablePolicy?0o444:0o400);
 for(const [name,value] of Object.entries({'ca.pem':broker.certificate,'account.json':JSON.stringify({oauthAccount:job.policy.nativeIdentity,hasCompletedOnboarding:true}),'auth.json':JSON.stringify({claudeAiOauth:{...job.policy.nativeIdentity,accessToken:broker.capability,refreshToken:''}})})){writeFileSync(path.join(dir,name),value);chmodSync(path.join(dir,name),0o444);}
 const child=spawn('/usr/bin/systemd-run',['--quiet','--wait','--pipe','--collect','--service-type=exec',`--unit=${unit}`,...unitProperties(root,dir,id,seconds).flatMap(p=>['--property',p]),'--setenv',`QA_CAPABILITY=${broker.capability}`,...args],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';let firstResolve:(s:string)=>void=()=>{},firstReject:(e:Error)=>void=()=>{};const first=new Promise<string>((r,j)=>{firstResolve=r;firstReject=j;});
 void first.catch(()=>{}); // Hook qualification awaits exit rather than the first stdout line.
 child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('\n'))firstResolve(stdout.split('\n')[0]);});child.stderr.on('data',b=>stderr+=b);
 const done=new Promise<number|null>(r=>child.on('close',code=>{if(!stdout.includes('\n'))firstReject(new Error('Boundary probe exited before reporting'));r(code);}));child.stdin.on('error',()=>{});child.stdin.end(job.prompt);
 return{first,done,unit,broker,output:()=>({stdout,stderr})};
}
try {
 const first=await launch(['/opt/qa/probe','0',String(port),marker,'1']);
 const a=JSON.parse(await first.first);
 const second=await launch(['/opt/qa/probe',String(a.pid),String(port),marker,'0']);
 const b=JSON.parse(await second.first);assert.equal(await second.done,0);assert.notEqual(a.uid,b.uid);
 for(const x of [a,b])for(const key of ['otherProcessReadable','hostCanaryReadable','hostNetworkReachable','externalNetworkReachable','rootWritable','priorJobVisible','shellPresent'])assert.equal(x[key],false,key);
 await first.done;
 assert.ok(!existsSync(`/proc/${a.pid}`),'main cgroup process reaped');assert.ok(!existsSync(`/proc/${a.child}`),'descendant reaped');
 const hook=await launch(['/opt/qa/launcher'],true,20);const code=await hook.done;
 assert.equal(readFileSync(marker,'utf8'),'UNCHANGED_DUMMY_CANARY');
 assert.equal(code,0);assert.equal(hook.broker.metrics().accepted,1);
 const unreadable=await launch(['/opt/qa/launcher'],false,5,false);assert.equal(await unreadable.done,78);assert.equal(unreadable.broker.metrics().forwarded,false);
 // Exact native diagnostic is not asserted: native JSON can absorb a non-blocking hook failure.
 console.log(JSON.stringify({boundary:[a,b],cgroupCleanup:true,seededManagedHook:{nativeExit:code,hostCanaryUnchanged:true,noShell:!existsSync(path.join(root,'bin/sh')),inferenceAccepted:1},unreadablePolicyRefused:true,rawLogsRetained:false}));
} finally {
 host.close();
 for(const r of resources){try{execFileSync('/usr/bin/systemctl',['stop',`${r.unit}.service`],{stdio:'ignore',timeout:6000})}catch{}await r.broker.close();rmSync(r.dir,{recursive:true,force:true});}
 rmSync(marker,{force:true});
}
