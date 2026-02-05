#!/usr/bin/env python3
import json,urllib.request,urllib.error,time
API="http://127.0.0.1:4000"
email=f"test.import.{int(time.time())}@example.com"
print("signup",email)
req=urllib.request.Request(API+"/auth/signup",data=json.dumps({"email":email,"password":"password123","displayName":"Tester"}).encode(),headers={"Content-Type":"application/json"})
with urllib.request.urlopen(req) as r:
    j=json.load(r)
token=j["token"]
print("token",token[:20]+"...")
# call import
url="https://www.beatify.me/blessedrthe"
req=urllib.request.Request(API+"/external/profile/import",data=json.dumps({"url":url}).encode(),headers={"Content-Type":"application/json","Authorization":f"Bearer {token}"})
try:
    with urllib.request.urlopen(req) as r:
        res=json.load(r)
        print(json.dumps(res,indent=2))
except urllib.error.HTTPError as e:
    print('HTTP',e.code,e.read().decode())
