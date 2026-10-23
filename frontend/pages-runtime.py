"""Reuse Flask's business routes entirely inside a browser worker, without sockets."""
import base64
import hashlib
import json
import os
import sys

# Pyodide does not expose OpenSSL scrypt/PBKDF2. Use the maintained WASM
# PyCryptodome PBKDF2 implementation through Werkzeug's normal salted format.
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256, SHA512
if not hasattr(hashlib, 'pbkdf2_hmac'):
    def pbkdf2_hmac(name, password, salt, iterations, dklen=None):
        module = {'sha256': SHA256, 'sha512': SHA512}[name]
        return PBKDF2(password, salt, dkLen=dklen or module.digest_size,
                      count=iterations, hmac_hash_module=module)
    hashlib.pbkdf2_hmac = pbkdf2_hmac

import werkzeug.security
_generate_hash = werkzeug.security.generate_password_hash
def browser_password_hash(password, method='pbkdf2:sha256:600000', salt_length=16):
    return _generate_hash(password, method=method, salt_length=salt_length)
werkzeug.security.generate_password_hash = browser_password_hash

sys.path.insert(0, '/workspace')
os.environ['TRADEFXBOOK_STATE_FILE'] = '/workspace/browser-state.json'
from backend import app as backend

# Browser profiles remain local. They do not authenticate a cloud account.
backend.DEFAULT_ACCOUNT['settings'].update(symbol='XAUUSD', timeframe='5m')
backend.DEFAULT_STATE['accounts'][0]['settings'].update(symbol='XAUUSD', timeframe='5m')
backend.DEFAULT_STATE['users'][0]['name'] = 'Browser User'
backend.app.config.update(TESTING=True)
client = backend.app.test_client()


def dispatch(request_json):
    request = json.loads(request_json)
    path = request['path']
    if not path.startswith('/api/') or path.startswith('/api/market/'):
        raise ValueError('Only local business API calls are accepted here.')
    response = client.open(path, method=request.get('method','GET'),
                           data=request.get('body'),
                           content_type=request.get('contentType','application/json'))
    state = None
    if os.path.exists(backend.DATA_FILE):
        with open(backend.DATA_FILE, encoding='utf-8') as stream: state = stream.read()
    return json.dumps({'status':response.status_code,
                       'headers':dict(response.headers),
                       'body':base64.b64encode(response.data).decode('ascii'),
                       'state':state})
