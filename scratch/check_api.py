import urllib.request, json
req = urllib.request.Request(
    'http://127.0.0.1:8000/api/chat',
    data=b'{"messages": [{"role": "user", "content": "hello"}]}',
    headers={'Content-Type': 'application/json'}
)
print(urllib.request.urlopen(req).read().decode())
