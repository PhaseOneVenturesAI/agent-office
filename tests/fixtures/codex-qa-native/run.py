#!/usr/bin/env python3
"""Exercise the compiled Office adapter, never real credentials/providers. See README."""
import base64, hashlib, http.server, json, os, pathlib, pwd, subprocess, sys, tempfile, threading, time

assert os.geteuid() == 0, 'Run under root in the documented disposable network namespace'
assert os.readlink('/proc/self/ns/net') != os.readlink('/proc/1/ns/net'), 'Private network namespace required'
assert subprocess.check_output(['ip', 'route'], text=True).strip() == '', 'No routes allowed'
assert {item['ifname'] for item in json.loads(subprocess.check_output(['ip', '-j', 'link'], text=True))} == {'lo'}, 'Loopback only'
module = pathlib.Path(sys.argv[1]).resolve()
assert module.is_file(), 'Pass compiled staff-qa-codex.js'
root = pathlib.Path(tempfile.mkdtemp(prefix='office-qa-native-'))
root.chmod(0o755)
account = pwd.getpwnam('agentoffice')
requests = []
scenario = {}

class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        requests.append({'path': self.path, 'body': body, 'bearer': self.headers.get('Authorization', '').startswith('Bearer '), 'account': self.headers.get('ChatGPT-Account-ID')})
        if scenario.get('unauthorized'):
            self.send_response(401); self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(b'{"error":{"message":"Expired dummy token"}}'); return
        forged = scenario.get('forge') if len(requests) == 1 else None
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        def event(name, data):
            self.wfile.write(('event: ' + name + '\ndata: ' + json.dumps(data) + '\n\n').encode()); self.wfile.flush()
        item = {'type': 'function_call', 'id': 'fc_stub', 'call_id': 'call_stub', 'name': forged, 'arguments': json.dumps({'cmd': 'touch ' + scenario['canary'], 'command': 'touch ' + scenario['canary']})} if forged else {'type': 'message', 'id': 'msg_stub', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'QA_STUB_OK', 'annotations': []}]}
        try:
            event('response.created', {'type': 'response.created', 'response': {'id': 'resp_stub', 'status': 'in_progress', 'output': []}})
            event('response.output_item.added', {'type': 'response.output_item.added', 'output_index': 0, 'item': item})
            event('response.output_item.done', {'type': 'response.output_item.done', 'output_index': 0, 'item': item})
            event('response.completed', {'type': 'response.completed', 'response': {'id': 'resp_stub', 'status': 'completed', 'output': [item], 'usage': {'input_tokens': 10, 'output_tokens': 10, 'total_tokens': 20}}})
        except BrokenPipeError: pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 18765), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
summary = []
for case in ['baseline', 'exec_command', 'apply_patch', 'spawn_agent', 'mcp__evil__write', 'unauthorized', 'unknown-model']:
    requests = []
    scenario = {'forge': case if case not in ['baseline', 'unauthorized', 'unknown-model'] else None, 'unauthorized': case == 'unauthorized', 'canary': str(root / case / 'CANARY_CHANGED')}
    folder = root / case; folder.mkdir(); os.chown(folder, account.pw_uid, account.pw_gid)
    source = folder / 'source'; source.mkdir(); os.chown(source, account.pw_uid, account.pw_gid)
    claims = {'exp': int(time.time()) + 3600, 'https://api.openai.com/auth': {'chatgpt_account_id': 'dummy-custodian', 'chatgpt_plan_type': 'pro'}}
    token = 'e30.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.dummy'
    auth = source / 'auth.json'
    auth.write_text(json.dumps({'auth_mode': 'chatgpt', 'tokens': {'id_token': token, 'access_token': token, 'refresh_token': 'RENEWABLE_CANARY_NEVER_COPY', 'account_id': 'dummy-custodian'}}))
    (source / 'AGENTS.md').write_text('PRIVATE_MANAGER_CONTEXT_CANARY')
    before = hashlib.sha256(auth.read_bytes()).hexdigest()
    wrapper = folder / 'codex-wrapper'
    wrapper.write_text('''#!/usr/bin/python3
import json,os,pathlib,sys
if '--version' not in sys.argv:
 p=pathlib.Path(''' + repr(str(folder / 'launch.json')) + ''')
 p.write_text(json.dumps({'home':os.environ['CODEX_HOME'],'cwd':os.getcwd(),'auth':json.loads(pathlib.Path(os.environ['CODEX_HOME'],'auth.json').read_text())}))
extra=[] if '--version' in sys.argv else ['-c','model_provider="stub"','-c','chatgpt_base_url="http://127.0.0.1:18765"','-c','model_providers.stub.name="Local dummy"','-c','model_providers.stub.base_url="http://127.0.0.1:18765/v1"','-c','model_providers.stub.requires_openai_auth=true','-c','model_providers.stub.supports_websockets=false','-c','model_providers.stub.wire_api="responses"']
os.execv('/usr/bin/codex',['/usr/bin/codex']+sys.argv[1:]+extra)
''')
    wrapper.chmod(0o755)
    runner = folder / 'runner.mjs'
    runner.write_text('import {codexStaffQaAsk} from ' + json.dumps(module.as_uri()) + ';\nconsole.log(JSON.stringify(await codexStaffQaAsk(' + json.dumps({'file': str(wrapper), 'env': {'PATH': '/usr/bin:/bin', 'CODEX_HOME': str(source)}, 'prompt': 'Answer from APPROVED_CONTEXT only.', 'model': 'unknown' if case == 'unknown-model' else 'gpt-6.2-sol'}) + ')));\n')
    def demote():
        os.setgroups([]); os.setgid(account.pw_gid); os.setuid(account.pw_uid)
    result = subprocess.run(['/usr/bin/node', str(runner)], cwd=folder, env={'PATH': '/usr/bin:/bin', 'HOME': str(folder)}, preexec_fn=demote, text=True, capture_output=True, timeout=140)
    assert result.returncode == 0, result.stderr
    outcome = json.loads(result.stdout.strip())
    assert hashlib.sha256(auth.read_bytes()).hexdigest() == before
    assert not (folder / 'CANARY_CHANGED').exists()
    assert all(not r['body'].get('tools') for r in requests)
    assert not any('PRIVATE_MANAGER_CONTEXT_CANARY' in json.dumps(r) or 'RENEWABLE_CANARY_NEVER_COPY' in json.dumps(r) for r in requests)
    assert all(r['path'] == '/v1/responses' for r in requests), 'No telemetry, refresh or other endpoints'
    assert all(r['bearer'] and r['account'] == 'dummy-custodian' for r in requests)
    if scenario.get('forge'):
        outputs = [item.get('output', '') for request in requests[1:] for item in request['body'].get('input', []) if item.get('type') == 'function_call_output']
        assert any('unsupported call' in output for output in outputs), 'Native handler must explicitly reject forged call'
    launched = folder / 'launch.json'
    if case == 'unknown-model':
        assert not launched.exists() and not requests and not outcome['ok']
    else:
        launch = json.loads(launched.read_text())
        assert launch['auth']['auth_mode'] == 'chatgptAuthTokens'
        assert launch['auth']['tokens']['refresh_token'] == ''
        assert not pathlib.Path(launch['home']).exists() and not pathlib.Path(launch['cwd']).exists()
        assert bool(requests)
    if case == 'baseline': assert outcome == {'ok': True, 'answer': 'QA_STUB_OK'}
    if case == 'unauthorized': assert not outcome['ok']
    record = {'case': case, 'outcome': outcome, 'requests': requests, 'source_unchanged': True, 'scratch_removed': True}
    (folder / 'result.json').write_text(json.dumps(record, indent=2))
    summary.append({'case': case, 'outcome': outcome, 'request_count': len(requests)})
    print(json.dumps(summary[-1]), flush=True)
(root / 'summary.json').write_text(json.dumps(summary, indent=2))
print('Evidence:', root, flush=True)
