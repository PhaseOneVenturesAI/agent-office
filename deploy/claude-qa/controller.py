#!/usr/bin/env python3
"""Narrow root controller. No user-selected commands, paths, environment or provider endpoints."""
import collections,fcntl,json,math,os,pathlib,re,select,selectors,secrets,shutil,signal,socket,stat,struct,subprocess,threading,time

CONFIG='/etc/agent-office-claude-qa/controller.json'
SOCKET='/run/agent-office-claude-qa/controller.sock'
WORKER='/opt/agent-office-claude-qa/controller-worker.mjs'
IMAGE='/var/lib/agent-office-claude-qa/image'
APP_UNIT='agent-office.service'
MAX_REQUEST=128_000
MAX_OUTPUT=1_000_000
DEADLINE=120
ID=re.compile(r'^[a-f0-9]{16}$')
UUID=re.compile(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$')

def strict_json(raw):
 def pairs(items):
  result={}
  for key,value in items:
   if key in result:raise ValueError('Duplicate key')
   result[key]=value
  return result
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite number')))

def protected_path(path,owners={0},directory=False):
 """Open each component without following links; keep reads anchored to those directory FDs."""
 if not isinstance(path,str) or not path.startswith('/') or pathlib.PurePath(path).as_posix()!=path or any(p in ('.','..') for p in path.split('/')[1:]):raise ValueError('Noncanonical path')
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  parts=path.split('/')[1:]
  for index,part in enumerate(parts):
   flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC
   if index<len(parts)-1 or directory:flags|=os.O_DIRECTORY
   next_fd=os.open(part,flags,dir_fd=fd);os.close(fd);fd=next_fd
   s=os.fstat(fd)
   if s.st_uid not in owners or s.st_mode&0o022:raise ValueError('Unsafe ownership or write mode')
  s=os.fstat(fd)
  if directory and not stat.S_ISDIR(s.st_mode):raise ValueError('Directory required')
  if not directory and (not stat.S_ISREG(s.st_mode) or s.st_nlink!=1):raise ValueError('Regular unlinked artifact required')
  return fd
 except BaseException:os.close(fd);raise

def read_at(root_fd,parts,owners,limit=1_000_000,optional=False,private=False):
 fd=os.dup(root_fd)
 try:
  for index,part in enumerate(parts):
   if not part or '/' in part or part in ('.','..'):raise ValueError('Invalid component')
   try:next_fd=os.open(part,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|(os.O_DIRECTORY if index<len(parts)-1 else 0),dir_fd=fd)
   except FileNotFoundError:
    if optional:return None
    raise
   os.close(fd);fd=next_fd;s=os.fstat(fd)
   if s.st_uid not in owners or s.st_mode&0o022:raise ValueError('Unsafe account artifact')
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>limit:raise ValueError('Invalid account file')
  if private and s.st_mode&0o077:raise ValueError('Private credential file required')
  raw=os.read(fd,limit+1)
  if len(raw)>limit:raise ValueError('Account file too large')
  return strict_json(raw)
 finally:os.close(fd)

def resolve_selected(data_dir,uid,account_id,now=None):
 """Read only the canonical selected account. Never return refresh tokens or other providers."""
 if not ID.fullmatch(account_id):raise ValueError('Invalid canonical account')
 root=protected_path(data_dir,{0,uid},True)
 try:
  accounts=read_at(root,['accounts.json'],{0,uid})
  matches=[a for a in accounts['accounts'] if a.get('id')==account_id]
  if len(matches)!=1:raise ValueError('Selected account unavailable')
  base=['homes',account_id]
  saved=read_at(root,base+['signins.json'],{0,uid},optional=True)
  if saved is not None and (not isinstance(saved,dict) or 'claude' in saved):raise ValueError('Own native OAuth login required')
  identity=read_at(root,base+['claude','.claude.json'],{0,uid})['oauthAccount']
  selected={key:identity[key] for key in ['accountUuid','organizationUuid']}
  if not all(isinstance(v,str) and UUID.fullmatch(v) for v in selected.values()):raise ValueError('OAuth identity unavailable')
  if 'workspaceUuid' in identity:
   if not isinstance(identity['workspaceUuid'],str) or not UUID.fullmatch(identity['workspaceUuid']):raise ValueError('Invalid workspace identity')
   selected['workspaceUuid']=identity['workspaceUuid']
  credentials=read_at(root,base+['claude','.credentials.json'],{0,uid},64_000,private=True)['claudeAiOauth']
  token=credentials.get('accessToken');expiry=credentials.get('expiresAt');scopes=credentials.get('scopes')
  current=time.time()*1000 if now is None else now
  if not isinstance(token,str) or not re.fullmatch(r'sk-ant-oat\d+-[A-Za-z0-9_-]{20,8000}',token):raise ValueError('Native OAuth access token required')
  if not isinstance(expiry,(int,float)) or isinstance(expiry,bool) or not math.isfinite(expiry) or expiry<=current+(DEADLINE+30)*1000:raise ValueError('Fresh access token required; refresh is not permitted')
  if not isinstance(scopes,list) or len(scopes)>32 or not all(isinstance(s,str) and len(s)<128 for s in scopes) or 'user:inference' not in scopes:raise ValueError('Inference scope unavailable')
  subscription=credentials.get('subscriptionType')
  if subscription not in ('free','pro','max','team','enterprise'):raise ValueError('Subscription metadata unavailable')
  selected.update({'scopes':scopes,'expiresAt':expiry,'subscriptionType':subscription})
  return {'accountId':account_id,'accessToken':token,'oauthAccount':selected}
 finally:os.close(root)

def validate_request(value):
 if not isinstance(value,dict) or set(value)!={'v','requestId','custodianAccountId','prompt'} or type(value['v']) is not int or value['v']!=1:raise ValueError('Invalid request schema')
 if not isinstance(value['requestId'],str) or not re.fullmatch(r'[a-f0-9]{32}',value['requestId']):raise ValueError('Invalid request identity')
 if not isinstance(value['custodianAccountId'],str) or not ID.fullmatch(value['custodianAccountId']):raise ValueError('Invalid custodian')
 if not isinstance(value['prompt'],str) or not value['prompt'].strip() or len(value['prompt'].encode())>64_000:raise ValueError('Invalid approved question')
 return value

def main_pid():
 result=subprocess.run(['/usr/bin/systemctl','show',APP_UNIT,'--property=MainPID','--property=ActiveState','--property=SubState'],capture_output=True,text=True,timeout=2,check=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
 fields=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
 if fields.get('ActiveState')!='active' or fields.get('SubState')!='running':return 0
 return int(fields.get('MainPID','0'))

class Admission:
 def __init__(self,conn,uid,pid_reader=main_pid):
  self.pid,self.uid,_=struct.unpack('3i',conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));self.reader=pid_reader;self.pidfd=-1
  if self.pid<=1 or self.uid!=uid or self.pid!=self.reader():raise PermissionError('Not the active Office main process')
  self.pidfd=os.pidfd_open(self.pid,0)
  try:
   if not self.current():raise PermissionError('Office process changed')
  except BaseException:self.close();raise
 def current(self):
  return self.pidfd>=0 and not select.select([self.pidfd],[],[],0)[0] and self.pid==self.reader()
 def close(self):
  if self.pidfd>=0:os.close(self.pidfd);self.pidfd=-1

class Limits:
 def __init__(self):self.lock=threading.Lock();self.active=False;self.recent=collections.deque()
 def begin(self,account,request_id,now=None):
  now=time.monotonic() if now is None else now
  with self.lock:
   while self.recent and self.recent[0][0]<now-60:self.recent.popleft()
   if self.active or len(self.recent)>=12 or sum(a==account for _,a,_ in self.recent)>=2 or any(i==request_id for _,_,i in self.recent):return False
   self.active=True;self.recent.append((now,account,request_id));return True
 def finish(self):
  with self.lock:self.active=False

def unit_args(job_id):
 if not re.fullmatch('[a-f0-9]{12}',job_id):raise ValueError('Invalid internal job')
 props=['User=root','Group=root','KillMode=control-group','TimeoutStopSec=3s','RuntimeMaxSec=125s','TasksMax=64','MemoryMax=384M','CPUQuota=100%','UMask=0077','WorkingDirectory=/','NoNewPrivileges=yes']
 return ['/usr/bin/systemd-run','--quiet','--wait','--pipe','--collect','--service-type=exec',f'--unit=office-claude-qa-controller-job-{job_id}',*[p for prop in props for p in ('--property',prop)],'/usr/bin/node',WORKER]

def stop_job(job_id):
 if not re.fullmatch('[a-f0-9]{12}',job_id):raise ValueError('Invalid cleanup identity')
 clean=True
 for unit in [f'office-claude-qa-{job_id}.service',f'office-claude-qa-controller-job-{job_id}.service']:
  try:
   subprocess.run(['/usr/bin/systemctl','stop',unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=6,check=False)
   info=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState','--property=ActiveState','--property=MainPID','--property=ControlGroup'],capture_output=True,text=True,timeout=2,check=True)
   fields=dict(line.split('=',1) for line in info.stdout.splitlines() if '=' in line)
   if fields.get('LoadState')=='not-found':continue
   if fields.get('ActiveState') not in ('inactive','failed') or fields.get('MainPID')!='0':clean=False
   group=fields.get('ControlGroup','')
   if group:
    if group!=f'/system.slice/{unit}':clean=False;continue
    events=pathlib.Path('/sys/fs/cgroup'+group)/'cgroup.events'
    try:
     if 'populated 1' in events.read_text():clean=False
    except FileNotFoundError:pass
  except (subprocess.SubprocessError,OSError):clean=False
 directory=pathlib.Path(IMAGE).parent/('job-'+job_id)
 try:
  s=directory.lstat()
  if clean and stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077:shutil.rmtree(directory)
  else:clean=False
 except FileNotFoundError:pass
 if not clean:raise RuntimeError('Exact job cleanup could not be verified')

def bounded_process(args,payload,conn,deadline=DEADLINE):
 """Fixed child only; count stdout+stderr while observing caller disconnect and wall timeout."""
 child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},close_fds=True)
 selector=selectors.DefaultSelector();output=bytearray();size=0;offset=0;started=time.monotonic()
 for stream,events in [(child.stdin,selectors.EVENT_WRITE),(child.stdout,selectors.EVENT_READ),(child.stderr,selectors.EVENT_READ)]:os.set_blocking(stream.fileno(),False);selector.register(stream,events)
 try:
  while selector.get_map():
   if time.monotonic()-started>deadline:raise TimeoutError('Job deadline')
   if select.select([conn],[],[],0)[0]:
    if not conn.recv(1,socket.MSG_PEEK):raise ConnectionError('Caller disconnected')
    raise ValueError('Unexpected trailing request')
   for key,_ in selector.select(.1):
    stream=key.fileobj
    if stream is child.stdin:
     offset+=os.write(stream.fileno(),payload[offset:offset+16384])
     if offset==len(payload):selector.unregister(stream);stream.close()
    else:
     chunk=os.read(stream.fileno(),16384)
     if not chunk:selector.unregister(stream);stream.close();continue
     size+=len(chunk)
     if size>MAX_OUTPUT:raise ValueError('Output bound exceeded')
     if stream is child.stdout:output.extend(chunk)
  if child.wait(timeout=3)!=0:raise ValueError('Job failed')
  value=strict_json(output)
  if not isinstance(value,dict) or type(value.get('ok')) is not bool:raise ValueError('Invalid worker result')
  if value['ok']:
   if set(value)!={'ok','answer'} or not isinstance(value['answer'],str) or not value['answer'].strip():raise ValueError('Invalid answer')
   return value
  if value!={'ok':False,'code':'unavailable'}:raise ValueError('Invalid worker failure')
  return value
 finally:
  selector.close()
  for stream in [child.stdin,child.stdout,child.stderr]:
   if not stream.closed:stream.close()
  if child.poll() is None:child.kill()
  child.wait(timeout=3)

def invoke(request,selected,conn):
 job_id=secrets.token_hex(6)
 payload=json.dumps({'request':request,'selected':selected,'runtimeId':job_id},separators=(',',':')).encode()
 try:return bounded_process(unit_args(job_id),payload,conn)
 finally:stop_job(job_id)

def receive(conn):
 expires=time.monotonic()+3
 def exact(count):
  output=bytearray()
  while len(output)<count:
   remaining=expires-time.monotonic()
   if remaining<=0:raise TimeoutError('Request deadline')
   conn.settimeout(remaining)
   chunk=conn.recv(min(16384,count-len(output)))
   if not chunk:raise ValueError('Incomplete frame')
   output.extend(chunk)
  return output
 size=struct.unpack('!I',exact(4))[0]
 if size<2 or size>MAX_REQUEST:raise ValueError('Invalid frame size')
 return validate_request(strict_json(exact(size)))

class Controller:
 def __init__(self,config,pid_reader=main_pid,resolver=resolve_selected,runner=invoke):self.config=config;self.pid_reader=pid_reader;self.resolver=resolver;self.runner=runner;self.limits=Limits()
 def handle(self,conn):
  admission=None;begun=False;request_id='';result={'ok':False,'code':'unavailable'}
  try:
   admission=Admission(conn,self.config['officeUid'],self.pid_reader)
   request=receive(conn);request_id=request['requestId']
   if not admission.current():raise PermissionError('Office process changed')
   begun=self.limits.begin(request['custodianAccountId'],request_id)
   if not begun:result={'ok':False,'code':'busy'}
   else:
    selected=self.resolver(self.config['officeDataDir'],self.config['officeUid'],request['custodianAccountId'])
    if not admission.current():raise PermissionError('Office process changed')
    result=self.runner(request,selected,conn)
  except PermissionError:result={'ok':False,'code':'denied'}
  except TimeoutError:result={'ok':False,'code':'timeout'}
  except (ValueError,KeyError,TypeError,json.JSONDecodeError):result={'ok':False,'code':'invalid'}
  except Exception:result={'ok':False,'code':'unavailable'}
  finally:
   if admission:admission.close()
   if begun:self.limits.finish()
   try:
    raw=json.dumps({'v':1,'requestId':request_id,**result},separators=(',',':')).encode()
    conn.settimeout(2);conn.sendall(struct.pack('!I',len(raw))+raw)
   except OSError:pass
   conn.close()

def load_config():
 fd=protected_path(CONFIG)
 try:
  if os.fstat(fd).st_size>8192:raise ValueError('Config too large')
  config=strict_json(os.read(fd,8193))
 finally:os.close(fd)
 if not isinstance(config,dict) or set(config)!={'version','officeDataDir','officeUid','officeGid'} or type(config['version']) is not int or config['version']!=1:raise ValueError('Invalid fixed controller config')
 if any(type(config[k]) is not int or config[k]<=0 for k in ['officeUid','officeGid']):raise ValueError('Non-root office identity required')
 fd=protected_path(config['officeDataDir'],{0,config['officeUid']},True);os.close(fd)
 for artifact in ['/usr/bin/node',WORKER]:
  fd=protected_path(artifact);os.close(fd)
 return config

def main():
 if os.geteuid()!=0:raise SystemExit('Root controller required')
 config=load_config();parent=str(pathlib.Path(SOCKET).parent);fd=protected_path(parent,directory=True);os.close(fd)
 lock=os.open(parent+'/controller.lock',os.O_CREAT|os.O_NOFOLLOW|os.O_RDWR,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  previous=os.lstat(SOCKET)
  if not stat.S_ISSOCK(previous.st_mode) or previous.st_uid!=0:raise ValueError('Unexpected socket artifact')
  os.unlink(SOCKET)
 except FileNotFoundError:pass
 server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(SOCKET);os.chown(SOCKET,0,config['officeGid']);os.chmod(SOCKET,0o660);server.listen(8)
 controller=Controller(config);slots=threading.BoundedSemaphore(4);stopping=threading.Event();server.settimeout(1)
 signal.signal(signal.SIGTERM,lambda *_:stopping.set());signal.signal(signal.SIGINT,lambda *_:stopping.set())
 def handle(conn):
  try:controller.handle(conn)
  finally:slots.release()
 try:
  while not stopping.is_set():
   try:conn,_=server.accept()
   except socket.timeout:continue
   if slots.acquire(False):threading.Thread(target=handle,args=(conn,),daemon=True).start()
   else:conn.close()
 finally:
  server.close()
  # In-flight units also have independent 120/125-second cgroup deadlines on abrupt controller loss.
  for _ in range(4):slots.acquire(timeout=DEADLINE+15)
  os.close(lock)

if __name__=='__main__':main()
