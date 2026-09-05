#!/usr/bin/env python3
"""
extract_cookies.py — Extract YouTube cookies from your browser and write them
to cookies.txt in strict Netscape format for yt-dlp.

USAGE:
    python extract_cookies.py                  # auto-detect browser, write to ./cookies.txt
    python extract_cookies.py --browser edge   # force Edge
    python extract_cookies.py --browser chrome # force Chrome
    python extract_cookies.py --browser firefox # force Firefox
    python extract_cookies.py --output "C:\\path\\to\\cookies.txt"  # custom output path
    python extract_cookies.py --auto-install   # write to multi-channel-ytl-main/cookies.txt

REQUIREMENTS:
    pip install browser_cookie3

WHAT IT DOES:
    1. Reads cookies from your browser's encrypted storage (handles DPAPI on Windows)
    2. Filters for YouTube-related domains (.youtube.com, .google.com, accounts.google.com)
    3. Writes to cookies.txt in strict Netscape format with correct flag column
       (domain starts with "." → flag=TRUE, else flag=FALSE)
    4. Verifies critical YouTube auth cookies are present (SID, SSID, HSID, etc.)
    5. Creates a timestamped backup of any existing cookies.txt before overwriting

WHY USE THIS INSTEAD OF THE BROWSER EXTENSION:
    - The extension sometimes produces malformed cookies.txt (wrong flag column)
    - The extension sometimes misses critical cookies like LOGIN_INFO
    - This script reads the cookies directly from the browser's DB, so it captures everything
    - Handles Windows DPAPI decryption natively (no yt-dlp DPAPI issues)
    - Works even while the browser is running (copies the DB to a temp file first)
"""

import argparse
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# Try to import browser_cookie3
try:
    import browser_cookie3
except ImportError:
    print("=" * 70)
    print("ERROR: browser_cookie3 is not installed.")
    print("=" * 70)
    print()
    print("Install it with:")
    print("    pip install browser_cookie3")
    print()
    print("If pip is not in your PATH, try:")
    print("    python -m pip install browser_cookie3")
    print()
    sys.exit(1)


# YouTube-related domains we want to capture cookies for
YOUTUBE_DOMAINS = {
    '.youtube.com',
    'youtube.com',
    '.google.com',
    'google.com',
    'accounts.google.com',
    '.accounts.google.com',
    'm.youtube.com',
    '.m.youtube.com',
}

# Critical YouTube auth cookies that yt-dlp needs for age-restricted videos
CRITICAL_COOKIES = [
    'SID',
    'SSID',
    'HSID',
    'APISID',
    'SAPISID',
    'LOGIN_INFO',
    'VISITOR_INFO1_LIVE',
    '__Secure-3PSID',
    'YSC',
    'PREF',
]

# Default output location if --auto-install is used
DEFAULT_INSTALL_PATH = r"C:\Program Files (x86)\multi-channel-ytl-main\cookies.txt"


def detect_browser():
    """Auto-detect which browser has YouTube cookies. Returns the browser name."""
    print("[detect] Auto-detecting browser with YouTube cookies...")

    # Order of preference: Edge → Chrome → Firefox → Brave
    browsers = ['edge', 'chrome', 'firefox', 'brave']

    for browser in browsers:
        try:
            print(f"[detect] Trying {browser}...")
            # Try to load just ONE cookie to see if the browser has any
            cj = load_browser_cookies(browser, domain='youtube.com')
            cookies = list(cj)
            youtube_cookies = [c for c in cookies if is_youtube_domain(c.domain)]
            if youtube_cookies:
                print(f"[detect] ✅ Found {len(youtube_cookies)} YouTube cookies in {browser}")
                return browser
            else:
                print(f"[detect] {browser} has no YouTube cookies")
        except Exception as e:
            print(f"[detect] {browser} not available: {e}")

    return None


def load_browser_cookies(browser, domain=None):
    """
    Load cookies from the specified browser.
    The `domain` parameter filters cookies server-side in newer browser_cookie3 versions,
    but older versions don't support it. We handle both cases.
    """
    # Try with domain filter first (newer API)
    # If that fails, fall back to loading all cookies and filtering ourselves
    if browser == 'edge':
        try:
            cj = browser_cookie3.edge(domain=domain) if domain else browser_cookie3.edge()
            return cj
        except TypeError:
            # Older API — doesn't support domain param
            cj = browser_cookie3.edge()
            return cj
        except Exception:
            # Fallback: try chromium-based loading with Edge's path
            try:
                return browser_cookie3.chromium(browser='Edge')
            except TypeError:
                return browser_cookie3.chromium(browser='Edge')
    elif browser == 'chrome':
        try:
            return browser_cookie3.chrome(domain=domain) if domain else browser_cookie3.chrome()
        except TypeError:
            return browser_cookie3.chrome()
    elif browser == 'firefox':
        try:
            return browser_cookie3.firefox(domain=domain) if domain else browser_cookie3.firefox()
        except TypeError:
            return browser_cookie3.firefox()
    elif browser == 'brave':
        try:
            cj = browser_cookie3.brave(domain=domain) if domain else browser_cookie3.brave()
            return cj
        except TypeError:
            return browser_cookie3.brave()
        except Exception:
            try:
                return browser_cookie3.chromium(browser='Brave')
            except TypeError:
                return browser_cookie3.chromium(browser='Brave')
    else:
        raise ValueError(f"Unknown browser: {browser}")


def is_youtube_domain(domain):
    """Check if a cookie domain is YouTube/Google-related."""
    if not domain:
        return False
    d = domain.lower()
    for yt_domain in YOUTUBE_DOMAINS:
        if d == yt_domain.lower() or d.endswith('.' + yt_domain.lower().lstrip('.')):
            return True
    return False


def cookie_to_netscape_line(cookie):
    """
    Convert a cookie object to a Netscape-format line.
    Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue

    The flag column must be:
    - "TRUE" if domain starts with "." (domain_specified=true)
    - "FALSE" if domain doesn't start with "." (this is the bug most exporters get wrong)
    """
    domain = cookie.domain or ''
    flag = 'TRUE' if domain.startswith('.') else 'FALSE'
    path = cookie.path or '/'
    secure = 'TRUE' if cookie.secure else 'FALSE'

    # Expiration: browser_cookie3 returns datetime objects or Unix timestamps
    # Netscape format expects Unix timestamp (seconds since epoch)
    if hasattr(cookie, 'expires') and cookie.expires:
        # Could be a datetime or a number
        if hasattr(cookie.expires, 'timestamp'):
            expiration = int(cookie.expires.timestamp())
        elif isinstance(cookie.expires, (int, float)):
            expiration = int(cookie.expires)
        else:
            expiration = 0
    else:
        expiration = 0

    name = cookie.name or ''
    value = cookie.value or ''

    # Escape any tabs/newlines in the value (rare but possible)
    value = value.replace('\t', '\\t').replace('\n', '\\n')
    name = name.replace('\t', '\\t').replace('\n', '\\n')

    return f"{domain}\t{flag}\t{path}\t{secure}\t{expiration}\t{name}\t{value}"


def write_cookies_file(cookies, output_path):
    """Write cookies to a Netscape-format file. Creates a backup first if file exists."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Create a backup of the existing file
    if output_path.exists():
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup_path = output_path.with_suffix(f'.txt.bak.{timestamp}')
        shutil.copy2(output_path, backup_path)
        print(f"[write] 📦 Backup of existing file: {backup_path}")

    # Write the new cookies file
    header = """# Netscape HTTP Cookie File
# Generated by extract_cookies.py on {timestamp}
# https://curl.se/docs/http-cookies.html
# This file was generated by browser_cookie3 + extract_cookies.py
#
""".format(timestamp=datetime.now().isoformat())

    lines = [header]
    for cookie in cookies:
        lines.append(cookie_to_netscape_line(cookie))

    content = '\n'.join(lines) + '\n'
    output_path.write_text(content, encoding='utf-8')
    print(f"[write] ✅ Wrote {len(cookies)} cookies to: {output_path}")
    print(f"[write]    File size: {output_path.stat().st_size} bytes")
    return len(cookies)


def verify_critical_cookies(cookies):
    """Check if critical YouTube auth cookies are present and not expired."""
    print()
    print("=" * 70)
    print("Critical YouTube auth cookies check:")
    print("=" * 70)

    now = time.time()
    found = {}
    for cookie in cookies:
        if cookie.name in CRITICAL_COOKIES:
            # Get expiration
            if hasattr(cookie, 'expires') and cookie.expires:
                if hasattr(cookie.expires, 'timestamp'):
                    exp = cookie.expires.timestamp()
                elif isinstance(cookie.expires, (int, float)):
                    exp = cookie.expires
                else:
                    exp = 0
            else:
                exp = 0
            found[cookie.name] = exp

    missing = []
    expired = []
    valid = []

    for name in CRITICAL_COOKIES:
        if name in found:
            exp = found[name]
            if exp > 0 and exp < now:
                print(f"  ❌ {name:25s} EXPIRED")
                expired.append(name)
            elif exp > 0:
                days_left = int((exp - now) / 86400)
                print(f"  ✅ {name:25s} valid (expires in {days_left} day(s))")
                valid.append(name)
            else:
                print(f"  ✅ {name:25s} valid (session cookie)")
                valid.append(name)
        else:
            print(f"  ❌ {name:25s} MISSING")
            missing.append(name)

    print()
    print(f"Summary: {len(valid)} valid, {len(missing)} missing, {len(expired)} expired")

    if missing or expired:
        print()
        print("⚠️  Some critical cookies are missing or expired!")
        print("   To fix:")
        print("   1. Open your browser, go to https://www.youtube.com")
        print("   2. Sign OUT completely, then sign back in")
        print("   3. Browse around for 30 seconds (homepage, subscriptions, watch a video)")
        print("   4. Re-run this script: python extract_cookies.py")
        return False
    else:
        print()
        print("✅ All critical YouTube cookies are present and valid!")
        print("   cookies.txt is ready for yt-dlp.")
        return True


def main():
    parser = argparse.ArgumentParser(
        description='Extract YouTube cookies from your browser and write to cookies.txt',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
    python extract_cookies.py
        Auto-detect browser, write to ./cookies.txt

    python extract_cookies.py --browser edge
        Force Edge browser

    python extract_cookies.py --output "C:\\path\\to\\cookies.txt"
        Custom output path

    python extract_cookies.py --auto-install
        Write to C:\\Program Files (x86)\\multi-channel-ytl-main\\cookies.txt
        (the default install location for multi-channel-ytl)
        """
    )
    parser.add_argument('--browser', choices=['edge', 'chrome', 'firefox', 'brave', 'auto'],
                        default='auto', help='Browser to extract cookies from (default: auto-detect)')
    parser.add_argument('--output', '-o', default='cookies.txt',
                        help='Output file path (default: ./cookies.txt)')
    parser.add_argument('--auto-install', action='store_true',
                        help=f'Write to {DEFAULT_INSTALL_PATH} (the multi-channel-ytl install location)')
    parser.add_argument('--cookie-path', default=None,
                        help='Custom output path (overrides --output and --auto-install). '
                             'Used by server.js to specify the exact cookies.txt location.')
    args = parser.parse_args()

    print("=" * 70)
    print("🍪 YouTube Cookie Extractor")
    print("=" * 70)
    print()

    # Determine output path (priority: --cookie-path > --auto-install > --output)
    if args.cookie_path:
        output_path = args.cookie_path
        print(f"[config] Output path (--cookie-path from server): {output_path}")
    elif args.auto_install:
        output_path = DEFAULT_INSTALL_PATH
        print(f"[config] Output path (--auto-install): {output_path}")
    else:
        output_path = args.output
        print(f"[config] Output path: {output_path}")
    print()

    # Detect or use the specified browser
    if args.browser == 'auto':
        browser = detect_browser()
        if not browser:
            print()
            print("❌ No browser with YouTube cookies found.")
            print("   Make sure you've visited https://www.youtube.com in your browser.")
            print("   Or specify a browser explicitly: --browser edge")
            sys.exit(1)
    else:
        browser = args.browser
        print(f"[config] Using browser: {browser}")

    print()

    # Load ALL cookies from the browser (not just youtube.com — we want google.com too)
    print(f"[load] Loading cookies from {browser}...")
    try:
        # Load without domain filter so we get all google.com cookies too
        cj = load_browser_cookies(browser)
        all_cookies = list(cj)
        print(f"[load] Loaded {len(all_cookies)} total cookies from {browser}")
    except Exception as e:
        print(f"[load] ❌ Failed to load cookies from {browser}: {e}")
        print()
        print("Troubleshooting:")
        print(f"  1. Make sure {browser} is installed")
        print("  2. Try closing the browser and re-running this script")
        print("  3. Make sure you're signed into YouTube in this browser")
        sys.exit(1)

    # Filter for YouTube/Google domains
    print()
    print("[filter] Filtering for YouTube/Google domains...")
    youtube_cookies = [c for c in all_cookies if is_youtube_domain(c.domain)]
    print(f"[filter] Found {len(youtube_cookies)} YouTube/Google cookies (out of {len(all_cookies)} total)")

    if not youtube_cookies:
        print()
        print("❌ No YouTube cookies found in this browser!")
        print("   To fix:")
        print("   1. Open your browser")
        print("   2. Go to https://www.youtube.com")
        print("   3. Sign in to your Google account")
        print("   4. Browse around for 30 seconds")
        print("   5. Re-run this script")
        sys.exit(1)

    # Sort cookies by domain, then by name for readability
    youtube_cookies.sort(key=lambda c: (c.domain or '', c.name or ''))

    # Write to file
    print()
    print("[write] Writing cookies.txt...")
    count = write_cookies_file(youtube_cookies, output_path)

    # Verify critical cookies
    verify_critical_cookies(youtube_cookies)

    print()
    print("=" * 70)
    print(f"✅ Done! {count} cookies written to: {output_path}")
    print("=" * 70)
    print()
    print("Next steps:")
    print("  1. Restart your server (node server.js) so it picks up the new cookies.txt")
    print("  2. The auto-repair feature will validate the file at startup")
    print("  3. Try downloading the age-restricted video again")


if __name__ == '__main__':
    main()
