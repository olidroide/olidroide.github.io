#!/usr/bin/env python3
"""Avisa a los buscadores IndexNow (Bing → ChatGPT/Copilot, Yandex, Seznam…) de que la web ha cambiado.

Uso, después de que GitHub Pages termine de desplegar:  python3 _tools/indexnow.py
"""
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

URLS = ["https://olidroide.es/", "https://olidroide.es/en/", "https://olidroide.es/llms.txt"]

config = (Path(__file__).resolve().parent.parent / "_config.yml").read_text(encoding="utf-8")
key = re.search(r'^indexnow_key:\s*"([0-9a-f]{32})"', config, re.M).group(1)
body = json.dumps({"host": "olidroide.es", "key": key, "keyLocation": f"https://olidroide.es/{key}.txt", "urlList": URLS}).encode()
req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body, headers={"Content-Type": "application/json; charset=utf-8"})
# verifica el certificado, pero sin el modo X.509 estricto de Python ≥3.13 que rechaza proxies TLS corporativos
ctx = ssl.create_default_context()
ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
    print(f"IndexNow → {r.status} ({'aceptado' if r.status in (200, 202) else 'revisar'})")
    sys.exit(0 if r.status in (200, 202) else 1)
