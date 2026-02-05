#!/usr/bin/env python3
import json
import urllib.request
import urllib.error
from urllib.parse import urljoin
import time

API = "http://127.0.0.1:4000"
EMAIL = f"test.invites.{int(time.time())}@example.com"
PASSWORD = "password123"
DISPLAY = "Test Inviter"
INV_EMAIL = f"invitee.{int(time.time())}@example.com"

def post(path, data, token=None):
    url = urljoin(API, path)
    data_b = json.dumps(data).encode('utf8')
    req = urllib.request.Request(url, data=data_b, method='POST')
    req.add_header('Content-Type','application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            print('HTTPError', e.code, e.read().decode())
            raise

def get(path, token=None):
    url = urljoin(API, path)
    req = urllib.request.Request(url, method='GET')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            print('HTTPError', e.code, e.read().decode())
            raise

print('SIGNUP ->', EMAIL)
sign = post('/auth/signup', {'email': EMAIL, 'password': PASSWORD, 'displayName': DISPLAY})
print('signup resp:', sign)
token = sign.get('token')
if not token:
    raise SystemExit('no token from signup')

print('TOKEN:', token)

# create content
cre = post('/content', {'title':'Test Content','type':'file'}, token=token)
print('create content:', cre)
cid = cre.get('id')
if not cid:
    raise SystemExit('no content id')

# get splits
spl = get(f'/content/{cid}/splits', token=token)
print('splits:', spl)
svid = spl.get('id')
if not svid:
    raise SystemExit('no split id')

# set participants
parts = {'participants':[{'participantEmail': INV_EMAIL, 'role':'contributor', 'percent':100}]}
up = post(f'/content/{cid}/splits', parts, token=token)
print('updated participants:', up)

# create invites
invcreate = post(f'/split-versions/{svid}/invite', {}, token=token)
print('create invites response:', invcreate)

myinv = get('/my/invitations', token=token)
print('\nMY INVITES:\n', json.dumps(myinv, indent=2))

recv = get('/my/invitations/received', token=token)
print('\nRECEIVED INVITES:\n', json.dumps(recv, indent=2))
