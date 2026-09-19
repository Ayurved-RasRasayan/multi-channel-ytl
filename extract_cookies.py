#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Multi-strategy YouTube cookie extractor (fallback)."""
import argparse, io, os, shutil, sqlite3, subprocess, sys, time, tempfile
from datetime import datetime
from pathlib import Path

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

YOUTUBE_DOMAINS = {'.youtube.com','youtube.com','.google.com','google.com','accounts.google.com','.accounts.google.com','m.youtube.com'}
CRITICAL = ['SID','SSID','HSID','APISID','SAPISID','LOGIN_INFO','VISITOR_INFO1_LIVE','__Secure-3PSID','YSC','PREF']

def is_yt(d):
    if not d: return False
    dd = d.lower().lstrip('.')
    return any(dd == y.lstrip('.') or dd.endswith('.'+y.lstrip('.')) for y in YOUTUBE_DOMAINS)

def write_file(rows, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Netscape HTTP Cookie File", f"# {datetime.now().isoformat()}", "#"]
    for r in rows:
        flag = 'TRUE' if r['domain'].startswith('.') else 'FALSE'
        sec = 'TRUE' if r['secure'] else 'FALSE'
        lines.append(f"{r['domain']}\t{flag}\t{r['path'] or '/'}\t{sec}\t{int(r['expires'] or 0)}\t{r['name']}\t{r['value']}")
    with open(out, 'wb') as f:
        f.write(('\n'.join(lines)+'\n').encode('utf-8'))
    print(f"[extract] Wrote {len(rows)} cookies to {out}")
    return len(rows)

def verify(rows):
    names = {r['name']: r['expires'] or 0 for r in rows}
    now = time.time()
    missing = []
    for c in CRITICAL:
        if c not in names:
            print(f"  X {c} MISSING"); missing.append(c)
        elif names[c] and names[c] < now:
            print(f"  X {c} EXPIRED"); missing.append(c)
        else:
            print(f"  + {c}")
    return len(missing) == 0

def s_bc3(browser):
    print("[extract] Strategy 1: browser_cookie3")
    try: import browser_cookie3
    except ImportError: return None
    try:
        cj = {'edge':browser_cookie3.edge,'chrome':browser_cookie3.chrome,'firefox':browser_cookie3.firefox,'brave':browser_cookie3.brave}.get(browser, browser_cookie3.edge)()
        rows = []
        for c in cj:
            if not is_yt(c.domain): continue
            exp = getattr(c, 'expires', None)
            exp_ts = int(exp.timestamp()) if hasattr(exp, 'timestamp') else (int(exp) if isinstance(exp, (int,float)) else 0)
            rows.append({'domain':c.domain,'path':c.path or '/','secure':bool(c.secure),'expires':exp_ts,'name':c.name,'value':c.value or ''})
        return rows if rows else None
    except Exception as e:
        print(f"[extract] browser_cookie3 failed: {e}")
        return None

def s_ytdlp(browser):
    print("[extract] Strategy 2: yt-dlp")
    ytdlp = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
    if not ytdlp: return None
    tmp = Path(tempfile.gettempdir()) / f'ytdlp_{os.getpid()}.txt'
    try:
        subprocess.run([ytdlp, '--cookies-from-browser', browser, '--cookies', str(tmp), '--skip-download','--flat-playlist','--no-warnings','--quiet','https://www.youtube.com/watch?v=dQw4w9WgXcQ'], capture_output=True, timeout=60)
        if tmp.exists() and tmp.stat().st_size > 0:
            rows = []
            for line in tmp.read_text(encoding='utf-8', errors='replace').splitlines():
                if not line or line.startswith('#'): continue
                f = line.split('\t')
                if len(f) >= 7 and is_yt(f[0]):
                    rows.append({'domain':f[0],'path':f[2],'secure':f[3].upper()=='TRUE','expires':int(f[4]) if f[4].isdigit() else 0,'name':f[5],'value':f[6]})
            tmp.unlink(missing_ok=True)
            return rows if rows else None
    except Exception as e:
        print(f"[extract] yt-dlp failed: {e}")
    tmp.unlink(missing_ok=True)
    return None

def s_pcc(browser):
    print("[extract] Strategy 3: pycookiecheat")
    try: import pycookiecheat
    except ImportError:
        try: subprocess.run([sys.executable,'-m','pip','install','--quiet','--no-input','pycookiecheat'], capture_output=True, timeout=120); import pycookiecheat
        except Exception: return None
    try:
        ck = pycookiecheat.chrome_cookies('https://www.youtube.com', browser={'edge':'edge','chrome':'chrome','brave':'brave','firefox':'firefox'}.get(browser,'edge')) or {}
        return [{'domain':'.youtube.com','path':'/','secure':True,'expires':0,'name':n,'value':v} for n,v in ck.items()] or None
    except Exception as e:
        print(f"[extract] pycookiecheat failed: {e}")
        return None

def s_win32(browser):
    print("[extract] Strategy 4: win32crypt")
    if sys.platform != 'win32': return None
    try: import win32crypt
    except ImportError:
        try: subprocess.run([sys.executable,'-m','pip','install','--quiet','--no-input','pywin32'], capture_output=True, timeout=180); import win32crypt
        except Exception: return None
    local = os.environ.get('LOCALAPPDATA','')
    cands = {'edge':Path(local)/'Microsoft'/'Edge'/'User Data'/'Default'/'Network'/'Cookies','chrome':Path(local)/'Google'/'Chrome'/'User Data'/'Default'/'Network'/'Cookies','brave':Path(local)/'BraveSoftware'/'Brave-Browser'/'User Data'/'Default'/'Network'/'Cookies'}
    db = cands.get(browser)
    if not db or not db.exists(): return None
    tmp = Path(tempfile.gettempdir()) / f'cc_{os.getpid()}.db'
    try: shutil.copy2(db, tmp)
    except Exception: return None
    rows = []
    try:
        conn = sqlite3.connect(str(tmp))
        cur = conn.cursor()
        cur.execute("SELECT host_key, path, is_secure, expires_utc, name, value, encrypted_value FROM cookies WHERE host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%'")
        for host, path, secure, expires, name, value, enc in cur.fetchall():
            if value: fv = value
            elif enc:
                try:
                    if enc[:3] in (b'v10', b'v11'): enc = enc[3:]
                    fv = win32crypt.CryptUnprotectData(enc, None, None, None, 0)[1].decode('utf-8', errors='replace')
                except Exception: continue
            else: continue
            exp_ts = int(expires/1000000 - 11644473600) if expires and expires > 0 else 0
            rows.append({'domain':host,'path':path,'secure':bool(secure),'expires':exp_ts,'name':name,'value':fv})
        conn.close()
    except Exception as e:
        print(f"[extract] win32crypt error: {e}")
    finally:
        tmp.unlink(missing_ok=True)
    return rows if rows else None

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--browser', default='edge', choices=['edge','chrome','firefox','brave','auto'])
    p.add_argument('--output','-o', default='cookies.txt')
    p.add_argument('--cookie-path', default=None)
    args = p.parse_args()
    out = args.cookie_path or args.output
    browser = args.browser if args.browser != 'auto' else 'edge'
    print("="*60)
    print("Cookie Extractor")
    print("="*60)
    print(f"Browser: {browser}")
    print(f"Output:  {out}")
    strategies = [s_bc3, s_ytdlp, s_pcc, s_win32]
    for s in strategies:
        try:
            rows = s(browser)
            if rows:
                has_login = any(r['name'] == 'LOGIN_INFO' for r in rows)
                if has_login:
                    print(f"[extract] {s.__name__} got {len(rows)} cookies with LOGIN_INFO")
                    write_file(rows, out)
                    verify(rows)
                    sys.exit(0)
                else:
                    print(f"[extract] {s.__name__} got {len(rows)} cookies but no LOGIN_INFO")
                    if not Path(out).exists():
                        write_file(rows, out)
        except Exception as e:
            print(f"[extract] {s.__name__} raised: {e}")
    print("[extract] No strategy produced LOGIN_INFO")
    sys.exit(1)

if __name__ == '__main__':
    main()
