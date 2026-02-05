#!/usr/bin/env bash
set -euo pipefail
API="http://127.0.0.1:4000"
EMAIL="test.invites.$(date +%s)@example.com"
PASSWORD="password123"
DISPLAY="Test Inviter"
INV_EMAIL="invitee.$(date +%s)@example.com"

echo "SIGNUP -> $EMAIL"
RESP=$(curl -sS -X POST "$API/auth/signup" -H "Content-Type: application/json" -d '{"email":"'$EMAIL'","password":"'$PASSWORD'","displayName":"'$DISPLAY'"}')
if [ -z "$RESP" ]; then echo "Empty response from signup"; exit 1; fi

echo "signup response: $RESP"
TOKEN=$(python3 - <<PY
import sys, json
j=json.load(sys.stdin)
print(j.get('token',''))
PY
<<<"$RESP")
if [ -z "$TOKEN" ]; then echo "Failed to extract token"; exit 1; fi

echo "TOKEN: $TOKEN"

# create content
CRESP=$(curl -sS -X POST "$API/content" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Test Content","type":"file"}')
echo "create content: $CRESP"
CID=$(python3 - <<PY
import sys,json
j=json.load(sys.stdin)
print(j.get('id',''))
PY
<<<"$CRESP")
if [ -z "$CID" ]; then echo "Failed to create content"; exit 1; fi

echo "content id: $CID"

# get splits
SRESP=$(curl -sS -X GET "$API/content/$CID/splits" -H "Authorization: Bearer $TOKEN")
echo "splits: $SRESP"
SVID=$(python3 - <<PY
import sys,json
j=json.load(sys.stdin)
print(j.get('id',''))
PY
<<<"$SRESP")
if [ -z "$SVID" ]; then echo "Failed to get split version id"; exit 1; fi

echo "split version id: $SVID"

# set participants (one participant to invite)
PARTS='{"participants":[{"participantEmail":"'$INV_EMAIL'","role":"contributor","percent":100}]}'
URESP=$(curl -sS -X POST "$API/content/$CID/splits" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$PARTS")
echo "update participants: $URESP"

# create invites for split version
IRESP=$(curl -sS -X POST "$API/split-versions/$SVID/invite" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}')
echo "create invites response: $IRESP"

# list my invites
MYINV=$(curl -sS -X GET "$API/my/invitations" -H "Authorization: Bearer $TOKEN")
echo "\nMY INVITES:\n$MYINV"

# list received invites (should be empty for the inviter)
RCV=$(curl -sS -X GET "$API/my/invitations/received" -H "Authorization: Bearer $TOKEN")
echo "\nRECEIVED INVITES:\n$RCV"
