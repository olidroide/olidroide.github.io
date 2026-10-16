#!/usr/bin/env python3
"""Comprueba el sitio generado en _site/ tras `bundle exec jekyll build`.

Uso: python3 _tools/check_site.py   (sale con 1 si algún check falla)
"""
import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "_site"
PAGES = {"es": SITE / "index.html", "en": SITE / "en" / "index.html"}
IDS = ["hero", "inicio", "logros", "mundos", "skills", "bonus", "contacto", "hud", "sky", "pix",
       "knobs", "pads", "keys", "strings", "vidH", "vidV", "i18n"]
results = []


def check(name):
    def wrap(fn):
        try:
            problem = fn()
        except Exception as e:  # un check que revienta es un FAIL, no un crash del script
            problem = f"{type(e).__name__}: {e}"
        results.append((name, problem))
        return fn
    return wrap


def html(lang):
    return PAGES[lang].read_text(encoding="utf-8")


def tag_with_id(doc, el_id):
    m = re.search(r"<[a-z]+\b[^>]*\bid=\"%s\"[^>]*>" % re.escape(el_id), doc)
    return m.group(0) if m else None


@check("pages")
def _():
    missing = [str(p.relative_to(SITE)) for p in PAGES.values() if not p.is_file()]
    return f"faltan {missing}" if missing else None


@check("lang")
def _():
    bad = [l for l in PAGES if not re.search(r'<html\b[^>]*\blang="%s"' % l, html(l))]
    return f"lang incorrecto en {bad}" if bad else None


@check("hreflang")
def _():
    need = ['hreflang="es" href="https://olidroide.es/"', 'hreflang="en" href="https://olidroide.es/en/"']
    bad = [(l, n) for l in PAGES for n in need
           if not re.search(r'<link\b[^>]*rel="alternate"[^>]*%s' % re.escape(n), html(l))]
    return f"faltan {bad}" if bad else None


@check("ids")
def _():
    bad = [(l, i) for l in PAGES for i in IDS if not tag_with_id(html(l), i)]
    return f"faltan {bad}" if bad else None


@check("banned")
def _():
    words = ["fps", "descargar cv", "download cv", "zerostatic", "+34"]
    hosts = r"youtube\.com|youtu\.be|instagram\.com|twitter\.com|//x\.com|\.x\.com"
    problems = []
    for l in PAGES:
        doc = html(l)
        low = doc.lower()
        problems += [(l, w) for w in words if w in low]
        problems += [(l, h) for h in re.findall(r'href="([^"]*(?:%s)[^"]*)"' % hosts, doc, re.I)]
        a, b = low.find('id="logros"'), low.find('id="mundos"')
        if a < 0 or b < a or "telef" in low[a:b]:
            problems.append((l, "tramo logros con 'telef' o sin delimitar"))
    return f"{problems}" if problems else None


@check("email_off")
def _():
    bad = []
    for l in PAGES:
        doc = html(l)
        spans = [(m.start(), m.end()) for m in re.finditer(r"<!--email_off-->.*?<!--/email_off-->", doc, re.S)]
        for m in re.finditer(r"hola@olidroide\.es", doc):
            if not any(s <= m.start() < e for s, e in spans):
                bad.append((l, m.start()))
    return f"emails sin envolver {bad}" if bad else None


@check("cfasync")
def _():
    # Rocket Loader solo reescribe JavaScript; los bloques JSON (ld+json de jekyll-seo-tag, i18n) no le afectan
    scripts = [t for l in PAGES for t in re.findall(r"<script\b[^>]*>", html(l))]
    bad = [t[:60] for t in scripts if 'data-cfasync="false"' not in t and not re.search(r'type="application/(ld\+)?json"', t)]
    return f"{bad}" if bad else None


@check("local_refs")
def _():
    missing = set()
    for l in PAGES:
        doc = html(l).replace('"https://olidroide.es/', '"/')   # las URLs absolutas propias (og:image, canonical) también deben existir
        for ref in re.findall(r'(?:src|href|poster|content)="(/(?!/)[^"?#]*)', doc):
            target = SITE / ref.lstrip("/")
            if ref.endswith("/"):
                target = target / "index.html"
            if not target.exists():
                missing.add(ref)
    return f"no existen {sorted(missing)}" if missing else None


@check("video_attrs")
def _():
    bad = []
    for l in PAGES:
        for vid in ("vidH", "vidV"):
            tag = tag_with_id(html(l), vid) or ""
            bad += [(l, vid, a) for a in ("muted", "playsinline", 'preload="none"') if not re.search(r"\b%s" % a, tag)]
    return f"{bad}" if bad else None


@check("jsonld")
def _():
    bad = []
    for l in PAGES:
        blocks = re.findall(r'<script\b[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html(l), re.S)
        people = [d for d in (json.loads(b) for b in blocks) for d in (d if isinstance(d, list) else [d])
                  if d.get("@type") == "Person" and d.get("alternateName") == "olidroide"]
        if not people:
            bad.append(l)
    return f"sin Person/olidroide en {bad}" if bad else None


@check("i18n_en")
def _():
    m = re.search(r'<script\b[^>]*id="i18n"[^>]*>(.*?)</script>', html("en"), re.S)
    if not m:
        return "no hay #i18n"
    data = json.loads(m.group(1))
    if data.get("lang") != "en":
        return f"lang={data.get('lang')!r}"
    level = data.get("oled", {}).get("level")
    return None if level == "LEVEL" else f"oled.level={level!r}"


@check("i18n_keys")
def _():
    # YAML lee claves como on/off/yes/no como booleanos: si pasa, el texto llega vacío a la página
    need = ["scroller", "knobs", "faders", "pads", "oled.idle_a", "oled.idle_b", "oled.level", "oled.pad", "oled.tap_tempo",
            "oled.now_playing", "oled.loop", "oled.stop", "oled.stopped", "oled.synth", "captions.h", "captions.v",
            "sound.on", "sound.playing", "aria.knob", "aria.fader"]
    bad = []
    for l in PAGES:
        doc = html(l)
        data = json.loads(re.search(r'<script\b[^>]*id="i18n"[^>]*>(.*?)</script>', doc, re.S).group(1))
        for key in need:
            v = data
            for part in key.split("."):
                v = v.get(part) if isinstance(v, dict) else None
            if not v:
                bad.append((l, key))
        snd = re.search(r'<button\b[^>]*id="snd"[^>]*>(.*?)</button>', doc, re.S)
        if not snd or not snd.group(1).strip():
            bad.append((l, "#snd vacío"))
    return f"faltan {bad}" if bad else None


@check("redirect_about")
def _():
    p = SITE / "about" / "index.html"
    if not p.is_file():
        return "no existe about/index.html"
    return None if "https://olidroide.es/" in p.read_text(encoding="utf-8") else "no redirige a https://olidroide.es/"


@check("sitemap")
def _():
    return None if (SITE / "sitemap.xml").is_file() else "no existe sitemap.xml"


@check("no_leaks")
def _():
    prefixes = ("docs/", "_tools", ".superpowers", "_cv_raw", "Gemfile", "README")
    leaks = [str(p.relative_to(SITE)) for p in SITE.rglob("*") if str(p.relative_to(SITE)).startswith(prefixes)]
    big = [str(p.relative_to(SITE)) for p in SITE.rglob("*.mp4") if p.stat().st_size > 7 * 1024 * 1024]
    problems = leaks[:5] + [f"{b} > 7 MB" for b in big]
    return f"{problems}" if problems else None


@check("js_budget")
def _():
    files = [SITE / "assets/js/hero.js", SITE / "assets/js/lab.js"]
    missing = [f.name for f in files if not f.is_file()]
    if missing:
        return f"faltan {missing}"
    total = sum(f.stat().st_size for f in files)
    return None if total < 70 * 1024 else f"{total / 1024:.1f} KB >= 70 KB"


if __name__ == "__main__":
    if not SITE.is_dir():
        sys.exit("No existe _site/: ejecuta antes `bundle exec jekyll build`")
    for name, problem in results:
        print(f"PASS {name}" if problem is None else f"FAIL {name}: {problem}")
    sys.exit(1 if any(p is not None for _, p in results) else 0)
