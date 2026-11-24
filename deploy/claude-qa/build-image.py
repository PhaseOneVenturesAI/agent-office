#!/usr/bin/env python3
"""Build a new scratch image only. Never installs units or changes host Claude policy."""
import hashlib,json,os,pathlib,shutil,subprocess,sys
if os.geteuid()!=0 or len(sys.argv)!=3: raise SystemExit('root: build-image.py EXACT_CLAUDE_BINARY NEW_IMAGE_DIR')
source=pathlib.Path(sys.argv[1]); root=pathlib.Path(sys.argv[2])
if not root.is_absolute() or str(root.parent.resolve())!=str(root.parent):raise SystemExit('Canonical absolute destination required')
for p in [root.parent,*root.parent.parents]:
 s=p.lstat()
 if not p.is_dir() or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('Root-owned protected image ancestry required')
expected='4c00839cf46beb2b38ec310105f2d538f7f9321fe46c636299b74bcab94626b1'
if hashlib.sha256(source.read_bytes()).hexdigest()!=expected: raise SystemExit('Unqualified Claude binary')
root.mkdir(mode=0o755) # Existing destinations are refused.
os.chmod(root,0o755)
for d in ['opt/qa','opt/claude','lib/x86_64-linux-gnu','lib64','etc/claude-code','work','tmp','proc','dev','sys','var/tmp','root','usr','run']:(root/d).mkdir(parents=True,exist_ok=True)
shutil.copyfile(source,root/'opt/claude/claude');os.chmod(root/'opt/claude/claude',0o555)
subprocess.run(['cc','-O2','-Wall','-Wextra','-Werror','-o',str(root/'opt/qa/launcher'),str(pathlib.Path(__file__).with_name('launcher.c'))],check=True)
os.chmod(root/'opt/qa/launcher',0o555)
for name in ['libc.so.6','librt.so.1','libpthread.so.0','libdl.so.2','libm.so.6']:
 shutil.copyfile('/lib/x86_64-linux-gnu/'+name,root/'lib/x86_64-linux-gnu'/name)
shutil.copyfile('/lib64/ld-linux-x86-64.so.2',root/'lib64/ld-linux-x86-64.so.2')
shutil.copyfile('/lib64/ld-linux-x86-64.so.2',root/'lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
(root/'etc/passwd').write_text('root:x:0:0:root:/nonexistent:/nonexistent\n')
(root/'etc/group').write_text('root:x:0:\n')
(root/'etc/nsswitch.conf').write_text('passwd: files\ngroup: files\nhosts: files\n')
(root/'etc/hosts').write_text('127.0.0.1 localhost\n')
(root/'etc/claude-code/managed-settings.json').write_text('{}\n')
(root/'broker.sock').touch()
for name in ['qa-ca.pem','qa-auth.json','qa-account.json']:(root/name).touch()
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
(root/'manifest.json').write_text(json.dumps({'claudeVersion':'2.1.331','files':files},indent=2)+'\n')
for p in root.rglob('*'):
 os.chown(p,0,0)
 if p.is_dir():os.chmod(p,0o755)
 if p.is_file() and not str(p.relative_to(root)).startswith('opt/'):os.chmod(p,0o444)
 if p.name=='ld-linux-x86-64.so.2':os.chmod(p,0o555)
print('Built isolated image:',root)
