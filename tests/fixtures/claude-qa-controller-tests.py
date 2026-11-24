#!/usr/bin/env python3
"""Dummy filesystem/socket tests; Linux root additionally qualifies transient cgroup cleanup."""
import importlib.util,json,os,pathlib,secrets,socket,struct,subprocess,sys,tempfile,threading,time,unittest
from unittest.mock import patch
source=pathlib.Path(sys.argv.pop(1));spec=importlib.util.spec_from_file_location('controller',source);c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
ACCOUNT='a'*16
def request():return {'v':1,'requestId':secrets.token_hex(16),'custodianAccountId':ACCOUNT,'prompt':'Approved dummy question.'}
def frame(value):
 raw=json.dumps(value).encode();return struct.pack('!I',len(raw))+raw
def reply(conn):
 raw=b''
 while len(raw)<4:raw+=conn.recv(4-len(raw))
 size=struct.unpack('!I',raw)[0];raw=b''
 while len(raw)<size:raw+=conn.recv(size-len(raw))
 return json.loads(raw)

class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='claude-qa-controller-',dir='/root' if os.geteuid()==0 else pathlib.Path.home());self.root=pathlib.Path(self.tmp.name);self.uid=os.getuid()
  self.home=self.root/'homes'/ACCOUNT/'claude';self.home.mkdir(parents=True)
  self.write(self.root/'accounts.json',{'accounts':[{'id':ACCOUNT}]})
  self.write(self.home/'.claude.json',{'oauthAccount':{'accountUuid':'1'*8+'-'+'1'*4+'-'+'1'*4+'-'+'1'*4+'-'+'1'*12,'organizationUuid':'2'*8+'-'+'2'*4+'-'+'2'*4+'-'+'2'*4+'-'+'2'*12}})
  self.credentials={'claudeAiOauth':{'accessToken':'sk-ant-oat01-'+'DUMMY'*8,'refreshToken':'NEVER_COPY_REFRESH','expiresAt':time.time()*1000+3600_000,'scopes':['user:inference'],'subscriptionType':'team'}}
  self.write(self.home/'.credentials.json',self.credentials)
 def tearDown(self):self.tmp.cleanup()
 def write(self,path,value):path.write_text(json.dumps(value));path.chmod(0o600)
 def resolve(self):return c.resolve_selected(str(self.root),self.uid,ACCOUNT)
 def test_access_only_selected_native_identity_and_no_fallback(self):
  selected=self.resolve();self.assertEqual(selected['accountId'],ACCOUNT);self.assertNotIn('NEVER_COPY_REFRESH',json.dumps(selected));self.assertEqual(selected['oauthAccount']['subscriptionType'],'team')
  for state in [{'claude':{'use':'office'}},{'claude':{'use':'token','token':'sk-ant-api03-DUMMY'}}]:
   self.write(self.home.parent/'signins.json',state)
   with self.assertRaises(ValueError):self.resolve()
  (self.home.parent/'signins.json').unlink()
  for change in [{'accessToken':'sk-ant-api03-'+'DUMMY'*8},{'expiresAt':time.time()*1000},{'scopes':[]}]:
   value=json.loads(json.dumps(self.credentials));value['claudeAiOauth'].update(change);self.write(self.home/'.credentials.json',value)
   with self.assertRaises(ValueError):self.resolve()
 def test_symlinks_hardlinks_writable_and_revoked_accounts_refused(self):
  file=self.home/'.credentials.json';saved=self.home/'saved';file.rename(saved);file.symlink_to('saved')
  with self.assertRaises(OSError):self.resolve()
  file.unlink();saved.rename(file);os.link(file,self.home/'hardlink')
  with self.assertRaises(ValueError):self.resolve()
  (self.home/'hardlink').unlink();file.chmod(0o644)
  with self.assertRaises(ValueError):self.resolve()
  file.chmod(0o600);self.write(self.root/'accounts.json',{'accounts':[]})
  with self.assertRaises(ValueError):self.resolve()
 def test_strict_metadata_and_fixed_resource_arguments(self):
  c.validate_request(request())
  for extra in [{'image':'/tmp/untrusted'},{'env':{}},{'command':'shell'},{'policy':{}},{'custodianAccountId':'../../other'},{'prompt':'x'*64001},{'v':True}]:
   value=request();value.update(extra)
   with self.assertRaises(ValueError):c.validate_request(value)
  with self.assertRaises(ValueError):c.strict_json('{"v":1,"v":2}')
  args=c.unit_args('a'*12);self.assertIn('MemoryMax=384M',args);self.assertIn('RuntimeMaxSec=125s',args);self.assertEqual(args[-2:],['/usr/bin/node',c.WORKER]);self.assertNotIn('DUMMY',str(args))
  with self.assertRaises(ValueError):c.unit_args('../agent-office')
 def test_active_duplicate_account_and_global_rates(self):
  limits=c.Limits();self.assertTrue(limits.begin(ACCOUNT,'one',0));self.assertFalse(limits.begin('other','two',0));limits.finish()
  self.assertFalse(limits.begin(ACCOUNT,'one',0));self.assertTrue(limits.begin(ACCOUNT,'two',0));limits.finish();self.assertFalse(limits.begin(ACCOUNT,'three',0))
  for n in range(10):self.assertTrue(limits.begin(str(n),str(n),0));limits.finish()
  self.assertFalse(limits.begin('new','new',0));self.assertTrue(limits.begin(ACCOUNT,'one',61));limits.finish()

 def test_frame_size_and_absolute_slow_input_deadline(self):
  left,right=socket.socketpair();left.sendall(struct.pack('!I',c.MAX_REQUEST+1))
  with self.assertRaises(ValueError):c.receive(right)
  left.close();right.close();left,right=socket.socketpair();left.sendall(struct.pack('!I',20)+b'{')
  def trickle():time.sleep(2);left.sendall(b'"')
  thread=threading.Thread(target=trickle);thread.start();started=time.monotonic()
  with self.assertRaises(TimeoutError):c.receive(right)
  self.assertLess(time.monotonic()-started,4);thread.join();left.close();right.close()

 @unittest.skipUnless(hasattr(socket,'SO_PEERCRED') and hasattr(os,'pidfd_open'),'Linux peer credentials')
 def test_actual_same_uid_other_pid_denied_before_credentials(self):
  pathname=str(self.root/'test.sock');server=socket.socket(socket.AF_UNIX);server.bind(pathname);server.listen(1)
  code='import socket,sys,struct,json;s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1]);s.sendall(b"0000");print(s.recv(1000).decode(errors="replace"))'
  child=subprocess.Popen([sys.executable,'-c',code,pathname],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  conn,_=server.accept();calls=[];ctl=c.Controller({'officeUid':self.uid,'officeDataDir':str(self.root)},pid_reader=os.getpid,resolver=lambda *_:calls.append('credential'),runner=lambda *_:calls.append('inference'))
  ctl.handle(conn);out,_=child.communicate(timeout=5);self.assertIn(b'denied',out);self.assertEqual(calls,[]);server.close()

 @unittest.skipUnless(hasattr(socket,'SO_PEERCRED') and hasattr(os,'pidfd_open'),'Linux peer credentials')
 def test_actual_main_pid_admitted_and_service_restart_denied(self):
  for changed in [False,True]:
   left,right=socket.socketpair();calls=[];reads=iter([os.getpid(),os.getpid(),1] if changed else [os.getpid()]*10)
   ctl=c.Controller({'officeUid':self.uid,'officeDataDir':str(self.root)},pid_reader=lambda:next(reads),resolver=lambda *_:{'dummy':True},runner=lambda *_:calls.append('inference') or {'ok':True,'answer':'DUMMY'})
   thread=threading.Thread(target=ctl.handle,args=(right,));thread.start();left.sendall(frame(request()));value=reply(left);left.close();thread.join(5)
   self.assertEqual(value['ok'],not changed);self.assertEqual(calls,[] if changed else ['inference'])

 @unittest.skipUnless(hasattr(socket,'SO_PEERCRED') and hasattr(os,'pidfd_open'),'Linux peer credentials')
 def test_pidfd_closed_when_service_lookup_fails_during_admission(self):
  left,right=socket.socketpair();before=len(os.listdir('/proc/self/fd'));calls=0
  def lookup():
   nonlocal calls
   calls+=1
   if calls>1:raise RuntimeError('systemd unavailable')
   return os.getpid()
  with self.assertRaises(RuntimeError):c.Admission(right,self.uid,lookup)
  self.assertEqual(len(os.listdir('/proc/self/fd')),before);left.close();right.close()

 @unittest.skipUnless(sys.platform=='linux' and os.geteuid()==0,'Root Linux non-root peer fixture')
 def test_two_nonroot_peers_with_same_uid_only_exact_main_pid_admitted(self):
  with tempfile.TemporaryDirectory(prefix='qa-peer-') as directory:
   os.chmod(directory,0o755);pathname=directory+'/controller.sock';server=socket.socket(socket.AF_UNIX);server.bind(pathname);os.chmod(pathname,0o666);server.listen(2)
   code='import json,socket,struct,sys,time;s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1]);b=sys.argv[2].encode();s.sendall(struct.pack("!I",len(b))+b);r=s.recv(1000);print(r[4:].decode(),flush=True);time.sleep(10)'
   def unprivileged():os.setgroups([]);os.setgid(65534);os.setuid(65534)
   first=subprocess.Popen([sys.executable,'-c',code,pathname,json.dumps(request())],stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=unprivileged)
   second=None;calls=[]
   try:
    ctl=c.Controller({'officeUid':65534,'officeDataDir':'UNUSED'},pid_reader=lambda:first.pid,resolver=lambda *_:{},runner=lambda *_:calls.append('inference') or {'ok':True,'answer':'DUMMY'})
    conn,_=server.accept();ctl.handle(conn);self.assertTrue(select_ready(first.stdout,3));self.assertTrue(json.loads(first.stdout.readline())['ok'])
    second=subprocess.Popen([sys.executable,'-c',code,pathname,json.dumps(request())],stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=unprivileged)
    conn,_=server.accept();ctl.handle(conn);self.assertTrue(select_ready(second.stdout,3));self.assertEqual(json.loads(second.stdout.readline())['code'],'denied');self.assertEqual(calls,['inference'])
   finally:
    for child in [first,second]:
     if child is not None:child.terminate();child.wait(timeout=3);child.stdout.close();child.stderr.close()
    server.close()

 def test_deadline_output_and_disconnect_kill_exact_child(self):
  for code,expected in [('import time;time.sleep(10)',TimeoutError),('import sys;sys.stdout.write("x"*1000001)',ValueError)]:
   left,right=socket.socketpair()
   with self.assertRaises(expected):c.bounded_process([sys.executable,'-c',code],b'{}',right,deadline=.2)
   left.close();right.close()
  left,right=socket.socketpair();left.close()
  with self.assertRaises(ConnectionError):c.bounded_process([sys.executable,'-c','import time;time.sleep(10)'],b'{}',right,deadline=.2)
  right.close()

 def test_cleanup_failure_cannot_return_success(self):
  with patch.object(c,'bounded_process',return_value={'ok':True,'answer':'DUMMY'}),patch.object(c,'stop_job',side_effect=RuntimeError('unclean')):
   with self.assertRaises(RuntimeError):c.invoke(request(),{'dummy':True},None)

 @unittest.skipUnless(sys.platform=='linux' and os.geteuid()==0,'Root Linux transient cgroup fixture')
 def test_actual_cgroup_cleanup_reaps_parent_and_descendant(self):
  job=secrets.token_hex(6);args=c.unit_args(job);args[-2:]=[sys.executable,'-c','import os,subprocess,time; p=subprocess.Popen(["/usr/bin/sleep","120"]); print(str(os.getpid())+" "+str(p.pid),flush=True); time.sleep(120)']
  child=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   self.assertTrue(select_ready(child.stdout,5));pids=[int(n) for n in child.stdout.readline().split()];self.assertEqual(len(pids),2)
   c.stop_job(job);child.wait(timeout=5)
   self.assertTrue(all(not pathlib.Path('/proc/'+str(pid)).exists() for pid in pids))
  finally:
   c.stop_job(job)
   if child.poll() is None:child.kill();child.wait()
   child.stdout.close();child.stderr.close()

def select_ready(stream,seconds):
 import select
 return bool(select.select([stream],[],[],seconds)[0])
unittest.main()
