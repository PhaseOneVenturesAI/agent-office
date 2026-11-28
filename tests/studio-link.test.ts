import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanProjectCommand, cleanProjectResult, projectFolder, validFolder, validRepo } from '../src/shared/protocol/studio.js';
import { LinkProjects } from '../src/server/link/projects.js';
import { linkRegistryFile, mergeRegistries, optionalRegistry, projectRegistry, requestsDir } from '../src/server/link/project-registry.js';
import { requestStatuses } from '../src/server/link/project-requests.js';
import { resolveTarget } from '../src/server/link/targets.js';
import { STUDIO_PROMPT } from '../src/server/link/studio-prompt.js';
import { sendHeadless } from '../src/server/link/headless.js';
function fixture(t: any) {
  mkdirSync('.paradev', { recursive: true }); const home = mkdtempSync(path.resolve('.paradev/studio-link-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = { home, projectsFile: path.join(home, 'harness.json'), state: path.join(home, '.agent-office/link/state'), computerId: randomUUID() };
  const bin = path.join(home, 'bin'), capture = path.join(home, 'calls.jsonl'); mkdirSync(bin); mkdirSync(config.state, { recursive: true });
  const script = `#!${process.execPath}
import fs from 'node:fs'; import path from 'node:path';
const args = process.argv.slice(2), bin = path.basename(process.argv[1]), cwd = process.cwd();
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({bin,args,cwd})+'\\n');
if (bin==='git' && args[0]==='init') { fs.mkdirSync('.git'); fs.writeFileSync('.git/config',''); }
if (bin==='gh' && args[1]==='clone') { fs.mkdirSync(args[3]); fs.mkdirSync(path.join(args[3],'.git')); fs.writeFileSync(path.join(args[3],'.git/config'),'[remote "origin"]\\nurl = https://github.com/'+args[2]+'.git\\n'); }
if (bin==='claude') {
 if(args[0]==='auth') { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'})); process.exit(0); }
 const id=args[args.indexOf(args.includes('--resume')?'--resume':'--session-id')+1];
 const native=path.join(${JSON.stringify(home)},'.claude/projects',cwd.replace(/[^a-zA-Z0-9]/g,'-')); fs.mkdirSync(native,{recursive:true}); fs.writeFileSync(path.join(native,id+'.jsonl'),'');
 fs.mkdirSync('.agent-office',{recursive:true}); fs.writeFileSync('.agent-office/draft.json',JSON.stringify({ideas:[{id:'idea',title:'Idea',feedback:[]}],screens:[{id:'home-v2',title:'Home',version:2,status:'approved',feedback:[]}],brand:{colors:['#123456']},plan:['Build'],decisions:['Keep it simple']}));
 let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({input:JSON.parse(input)})+'\\n');console.log(JSON.stringify({type:'assistant',session_id:id,message:{content:[{type:'text',text:'Hello Jonathan. What are we building?'}]}}));console.log(JSON.stringify({type:'result',session_id:id,subtype:'success'}));});
}
`;
  for (const name of ['git','gh','claude','ps']) writeFileSync(path.join(bin,name),script,{mode:0o755});
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous}`; t.after(() => { process.env.PATH = previous; });
  const results: any[] = [], link = new LinkProjects(config, r => results.push(r)); t.after(() => link.close());
  const calls = () => readFileSync(capture,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  return { home, config, results, link, calls };
}
test('Studio frame cleaners strictly validate identities, name, folder, repo and exact confirm', () => {
  const id=randomUUID(); assert.equal(projectFolder('Studio Test'),'Studio-Test');
  for(const name of ['', '.', '..', '...', 'x'.repeat(61), '-options', '☃']) assert.equal(projectFolder(name),undefined);
  for(const folder of ['../x','/tmp/x','a/b','a\\b','...','-foo']) assert.equal(validFolder(folder),false);
  for(const repo of ['a/b;touch x','https://github.com/a/b','../b','a/--x','a/b/c']) assert.equal(validRepo(repo),false);
  assert.deepEqual(cleanProjectCommand({t:'project.new',id,name:'Good',path:'/evil',args:['--bad']}),{t:'project.new',id,name:'Good'});
  assert.equal(cleanProjectCommand({t:'project.open',id,project:'Good',confirm:'good'}),undefined);
  assert.equal(cleanProjectCommand({t:'project.add',id}),undefined);
  assert.equal(cleanProjectCommand({t:'project.add',id,repo:'a/b',folder:'../x'}),undefined);
  assert.deepEqual(cleanProjectResult({t:'project.result',id,ok:true,detail:'Ready',project:'Good',repo:'a/b',path:'/private'}),{t:'project.result',id,ok:true,detail:'Ready',project:'Good',repo:'a/b'});
});
test('new → normal headless resume → open uses fixed argv, same session, private registry and requests; no real git/gh/claude', async t => {
  const f=fixture(t), id=randomUUID(); await f.link.receive({t:'project.new',id,name:'Studio Test'});
  assert.equal(f.results[0].ok,true,JSON.stringify(f.results));
  const p=optionalRegistry(linkRegistryFile(f.home)).projects['Studio Test'];
  assert.equal(p.office,'draft'); assert.equal(statSync(linkRegistryFile(f.home)).mode & 0o777,0o600); assert.equal(statSync(path.dirname(linkRegistryFile(f.home))).mode & 0o777,0o700);
  const request=JSON.parse(readFileSync(path.join(requestsDir(f.home),id+'.json'),'utf8'));
  assert.deepEqual(Object.keys(request).sort(),['schema','kind','id','createdAt','project','folder','repoUrl','leadSessionId','source'].sort()); assert.equal(request.kind,'new-project'); assert.equal(request.folder,'Studio-Test'); assert.equal(request.repoUrl,null); assert.equal(request.leadSessionId,p.leadSessionId); assert.equal(statSync(path.join(requestsDir(f.home),id+'.json')).mode & 0o777,0o600);
  assert.equal(resolveTarget(f.config,{project:'Studio Test'}).sessionId,p.leadSessionId);
  const claude=f.calls().find(c=>c.bin==='claude'&&c.args[0]==='--print'); assert.deepEqual(claude.args,['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--session-id',p.leadSessionId]);
  assert.equal(f.calls().find(c=>c.input)?.input.message.content,STUDIO_PROMPT);
  const reply=await sendHeadless(f.config,resolveTarget(f.config,{project:'Studio Test'}),{t:'lead.send',id:randomUUID(),target:{project:'Studio Test'},text:'Keep going',from:'Jonathan'},new AbortController().signal,path.join(f.home,'bin/claude'));
  assert.match(reply,/Hello Jonathan/); assert.ok(f.calls().some(c=>c.args?.includes('--resume')));
  await f.link.receive({t:'project.new',id:randomUUID(),name:'Studio Test'}); assert.equal(f.results.at(-1).ok,false);
  const before=f.calls().length; await f.link.receive({t:'project.open',id:randomUUID(),project:'Studio Test',confirm:'Wrong'}); assert.equal(f.calls().length,before);
  const openId=randomUUID(); await f.link.receive({t:'project.open',id:openId,project:'Studio Test',confirm:'Studio Test'}); assert.equal(f.results.at(-1).ok,true);
  const calls=f.calls(); assert.deepEqual(calls.find(c=>c.bin==='git')?.args,['init','-b','main']);
  assert.deepEqual(calls.find(c=>c.bin==='gh')?.args,['repo','create','PhaseOneVenturesAI/studio-test','--private','--source','.','--push']);
  assert.deepEqual(calls.find(c=>c.args?.includes('commit'))?.args,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-m','Open project floor']);
  assert.ok(calls.find(c=>c.args?.[0]==='add').args.includes('docs/BRIEF.md'));
  assert.ok(existsSync(path.join(p.path,'design/tokens.json')));
  const opened=optionalRegistry(linkRegistryFile(f.home)).projects['Studio Test']; assert.equal(opened.localState,'present'); assert.equal(opened.office,undefined); assert.equal(opened.leadSessionId,p.leadSessionId);
  const n=f.calls().length; await f.link.receive({t:'project.open',id:openId,project:'Studio Test',confirm:'Studio Test'}); assert.equal(f.calls().length,n);
  assert.match(requestStatuses(f.home)[0].status,/Waiting/);
  mkdirSync(path.join(requestsDir(f.home),'done')); writeFileSync(path.join(requestsDir(f.home),'done',openId+'.json'),JSON.stringify({status:'registered'})); assert.equal(requestStatuses(f.home)[0].status,'Harness: registered');
});
test('add clones with fixed argv; existing origin mismatch and existing new folder refused; harness wins by path or name', async t => {
  const f=fixture(t); await f.link.receive({t:'project.add',id:randomUUID(),repo:'PhaseOneVenturesAI/Skedaddle'}); assert.equal(f.results.at(-1).ok,true);
  const p=optionalRegistry(linkRegistryFile(f.home)).projects.Skedaddle;
  assert.deepEqual(f.calls().find(c=>c.bin==='gh').args,['repo','clone','PhaseOneVenturesAI/Skedaddle',p.path]);
  const starts=f.calls().filter(c=>c.args?.includes('--session-id')).length;
  await f.link.receive({t:'project.add',id:randomUUID(),folder:'Skedaddle'}); assert.equal(f.results.at(-1).ok,true); assert.equal(f.calls().filter(c=>c.args?.includes('--session-id')).length,starts);
  await f.link.receive({t:'project.add',id:randomUUID(),repo:'other/Skedaddle'}); assert.equal(f.results.at(-1).ok,false); assert.match(f.results.at(-1).detail,/origin/);
  mkdirSync(path.join(f.home,'Documents/GitHub/Taken')); await f.link.receive({t:'project.new',id:randomUUID(),name:'Taken'}); assert.match(f.results.at(-1).detail,/already exists/);
  const harness={projects:{Canonical:{path:p.path,leadSessionId:'harness',localState:'present'},Other:{path:'/primary'}}};
  const merged=mergeRegistries(harness,{projects:{Skedaddle:p,Other:{path:'/secondary'}}}); assert.deepEqual(merged,harness);
  writeFileSync(f.config.projectsFile,JSON.stringify(harness)); assert.deepEqual(projectRegistry(f.config),harness); assert.deepEqual(JSON.parse(readFileSync(f.config.projectsFile,'utf8')),harness);
});

test('pending harness registration never starts a second main lead; exact harness precedence is retained', async t => {
  const f=fixture(t), dir=path.join(f.home,'Documents/GitHub/Existing'); mkdirSync(path.join(dir,'.git'),{recursive:true});
  writeFileSync(path.join(dir,'.git/config'),'[remote "origin"]\nurl = https://github.com/acme/Existing.git\n');
  const harness={projects:{Existing:{path:dir,localState:'present'}}}; writeFileSync(f.config.projectsFile,JSON.stringify(harness));
  await f.link.receive({t:'project.add',id:randomUUID(),folder:'Existing'}); assert.equal(f.results.at(-1).ok,true);
  await f.link.receive({t:'project.add',id:randomUUID(),folder:'Existing'}); assert.equal(f.results.at(-1).ok,true);
  assert.equal(f.calls().filter(c=>c.args?.includes('--session-id')).length,1);
  assert.equal(projectRegistry(f.config).projects.Existing.leadSessionId,undefined);
  assert.throws(()=>resolveTarget(f.config,{project:'Existing'}),/not registered/);
});
