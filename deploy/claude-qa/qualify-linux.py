#!/usr/bin/env python3
"""Root-only dummy qualification. No installation, real authentication, or provider calls."""
import json,os,pathlib,shutil,subprocess,sys,tempfile,time
if os.geteuid()!=0 or len(sys.argv)!=3:raise SystemExit('root: qualify-linux.py EXACT_CLAUDE_BINARY REVIEWED_PAYLOAD_DIR')
native,payload=map(pathlib.Path,sys.argv[1:]);scratch=pathlib.Path(tempfile.mkdtemp(prefix='office-claude-qa-qualification-',dir='/root'))
os.umask(0o077)
def run(args,timeout=40):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if r.returncode:raise RuntimeError('Qualification command failed; inspect the reviewed scratch payload, not production services')
 return r.stdout
def record(name,args):
 value=json.loads(run(args));(scratch/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n');return value
try:
 image=scratch/'image';run(['python3',str(payload/'build-image.py'),str(native),str(image)])
 results={'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'nativeVersion':'2.1.331','dummyOnly':True}
 results['image']=record('image-checks',['node',str(payload/'claude-qa-image-driver.mjs'),str(image)])
 for mode in ['baseline','forged','oversize','timeout']:
  results[mode]=record(mode,['node',str(payload/'claude-qa-linux-driver.mjs'),str(image),mode])
 boundary=scratch/'boundary-image';shutil.copytree(image,boundary)
 # The probe is deliberately outside the production manifest and cannot pass verifyImage.
 run(['cc','-O2','-Wall','-Wextra','-Werror','-o',str(boundary/'opt/qa/probe'),str(payload/'claude-qa-boundary.c')])
 os.chmod(boundary/'opt/qa/probe',0o555)
 results['boundary']=record('boundary',['node',str(payload/'claude-qa-boundary-driver.mjs'),str(boundary)])
 leftovers=[p.name for p in scratch.iterdir() if p.name.startswith(('job-','boundary-')) and p.name!='boundary-image']
 if leftovers:raise RuntimeError('Fixture cleanup left job directories')
 results['jobDirectoriesCleaned']=True
 (scratch/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps({'ok':True,'scratch':str(scratch),'summary':str(scratch/'summary.json')}))
except Exception as error:
 (scratch/'failure.txt').write_text(type(error).__name__+'\n')
 print(json.dumps({'ok':False,'scratch':str(scratch),'reason':type(error).__name__}));sys.exit(1)
