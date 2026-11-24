import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { qaLaunch, qaBaseEnv, cliVersion } from '../src/server/staff-qa.js';

test('unverified providers fail closed with an actionable reason, never a fallback launch',()=>{
 assert.match(String(qaLaunch('claude')),/no verified isolated Q&A.*manager controller/);
 assert.match(String(qaLaunch('codex')),/qualified only.*gpt-6.2-sol/);
 for(const provider of ['claude','codex'] as const)assert.match(String(qaLaunch(provider)),/will not switch/);
});

test('Q&A environment inherits no Office, other-provider, or custom runtime secrets',()=>{
 const previous=process.env.AGENT_OFFICE_QA_TEST;process.env.AGENT_OFFICE_QA_TEST='synthetic';
 try {const env=qaBaseEnv();assert.equal(env.AGENT_OFFICE_QA_TEST,undefined);assert.deepEqual(Object.keys(env).filter(k=>!['PATH','LANG','LC_ALL','TMPDIR','TEMP','TMP','SystemRoot','WINDIR'].includes(k)),[]);}
 finally{if(previous===undefined)delete process.env.AGENT_OFFICE_QA_TEST;else process.env.AGENT_OFFICE_QA_TEST=previous;}
});

test('version check detects updates in place and retains unverified prerelease suffix',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'qa-version-'));const file=path.join(dir,'fake');
 try{writeFileSync(file,'#!/bin/sh\necho 2.7.2\n',{mode:0o700});assert.equal(cliVersion(file),'2.7.2');writeFileSync(file,'#!/bin/sh\necho 2.7.2-unverified\n');assert.equal(cliVersion(file),'2.7.2-unverified');}
 finally{rmSync(dir,{recursive:true,force:true});}
});
