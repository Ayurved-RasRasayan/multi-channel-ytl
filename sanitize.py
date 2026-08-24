#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Windows Filename Sanitizer
Keeps Unicode letters (Chinese, Arabic, Urdu, etc.) and sanitizes special chars
Excludes: ( ) from sanitization - they are kept as-is
NO COLLAPSING - every character stays as converted
"""

import re
import sys
import os
import json
import unicodedata

# ============================================================
# TRY TO IMPORT REGEX LIBRARY (FALLBACK TO BUILT-IN IF NOT AVAILABLE)
# ============================================================
try:
    import regex
    HAS_REGEX = True
except ImportError:
    HAS_REGEX = False

# ============================================================
# SANITIZATION FUNCTION
# ============================================================
def sanitize_filename(filename, convert_leading=True):
    """
    Sanitize a Windows filename:
    - Keeps: ALL Unicode letters (any language), numbers, spaces, '.', '_', '-', '(', ')'
    - Illegal Windows chars (\ / : * ? " < > |) -> '_'
    - Special chars (! @ # $ % ^ & + = { } [ ] ; ' , ~ `) -> '-'
    - Leading '_' or '-' -> 'Z' (optional)
    - Reserved names (CON, PRN, etc.) -> prefixed with '_'
    - NO COLLAPSING - every character stays as converted
    """
    
    if not filename or filename.strip() == '':
        return 'unnamed'
    
    sanitized = filename
    
    # ============================================================
    # STEP 1: Replace illegal Windows characters with '_'
    # ============================================================
    illegal_chars = r'[\\/*?:"<>|]'
    sanitized = re.sub(illegal_chars, '_', sanitized)
    
    # ============================================================
    # STEP 2: Replace special characters with '-'
    # Keep: ALL Unicode letters, numbers, space, ., _, -, (, )
    # ============================================================
    if HAS_REGEX:
        safe_pattern = r'[^\p{L}\p{N}\s\._\-()]'
        sanitized = regex.sub(safe_pattern, '-', sanitized)
    else:
        # Python 3: \w matches Unicode letters by default!
        # This preserves Urdu, Arabic, Chinese, etc. without needing 'regex' library
        safe_pattern = r'[^\w\s\.\-()]'
        sanitized = re.sub(safe_pattern, '-', sanitized)
    
    # ============================================================
    # STEP 3: NO COLLAPSING - removed entirely!
    # ============================================================
    # (Nothing here - keep all characters as-is)
    
    # ============================================================
    # STEP 4: Strip leading/trailing spaces and dots
    # ============================================================
    sanitized = sanitized.strip(' .')
    
    # ============================================================
    # STEP 5: Convert leading '_' or '-' to 'Z' (ALWAYS ON)
    # ============================================================
    if convert_leading and sanitized:
        if sanitized[0] in ['_', '-']:
            sanitized = 'Z' + sanitized[1:]
    
    # ============================================================
    # STEP 6: Handle reserved device names
    # ============================================================
    reserved = r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$'
    if re.match(reserved, sanitized, re.IGNORECASE):
        sanitized = '_' + sanitized
    
    # ============================================================
    # STEP 7: Enforce length limit (250 chars max)
    # ============================================================
    if len(sanitized) > 250:
        name, ext = sanitized.rsplit('.', 1) if '.' in sanitized else (sanitized, '')
        if ext:
            sanitized = name[:250 - len(ext) - 1] + '.' + ext
        else:
            sanitized = sanitized[:250]
    
    return sanitized if sanitized else 'unnamed'


# ============================================================
# CHARACTER BREAKDOWN FUNCTION
# ============================================================
def get_character_info(char):
    """Get category and conversion info for a single character"""
    
    if char in '\\/*?:"<>|':
        return ('Illegal', '_')
    
    if char in '!@#$%^&+={}[];\',~`':
        return ('Special', '-')
    
    if char.isascii() and (char.isalnum() or char in ' ._-()'):
        return ('Safe (ASCII)', char)
    
    if char.isalpha() and not char.isascii():
        return ('Unicode Letter', char)
    
    if char.isdigit() and not char.isascii():
        return ('Unicode Number', char)
    
    if ord(char) < 32:
        return ('Control', '_')
    
    return ('Special (Unicode)', '-')


def show_character_breakdown(filename):
    """Show what each character converts to"""
    print("\n" + "=" * 60)
    print("CHARACTER BREAKDOWN")
    print("=" * 60)
    print(f"{'Character':<15} {'Category':<20} {'Converts To':<15}")
    print("-" * 60)
    
    for char in filename:
        category, converts = get_character_info(char)
        display_char = repr(char) if char in [' ', '\t', '\n'] else char
        print(f"{display_char:<15} {category:<20} {converts:<15}")


# ============================================================
# WAIT FOR EXIT (KEEP WINDOW OPEN)
# ============================================================
def wait_for_exit():
    """Wait for user to press Enter, with multiple fallback methods"""
    print("\n" + "=" * 60)
    print("🔒 Press ENTER to close this window...")
    print("=" * 60)
    
    try:
        input()
        return
    except (EOFError, KeyboardInterrupt):
        pass
    
    try:
        os.system('pause >nul 2>&1')
        return
    except:
        pass
    
    try:
        raw_input()
        return
    except:
        pass
    
    import time
    print("⚠️  Input not available. Window will close in 10 seconds...")
    time.sleep(10)


# ============================================================
# MAIN INTERACTIVE LOOP
# ============================================================
def main():
    """Main interactive program"""
    
    if os.name == 'nt':
        os.system('title Windows Filename Sanitizer')
    
    print("=" * 60)
    print("WINDOWS FILENAME SANITIZER")
    print("=" * 60)
    
    if HAS_REGEX:
        print("✅ Regex library: INSTALLED (full Unicode support)")
    else:
        print("⚠️  Regex library: NOT INSTALLED (using fallback)")
        print("   Install: pip install regex")
    
    print("\nRules:")
    print("  • Illegal chars (\\ / : * ? \" < > |) → _")
    print("  • Special chars (! @ # $ % ^ & + = { } [ ] ; ' , ~ `) → -")
    print("  • KEPT AS-IS: ( ) [parentheses are safe!]")
    print("  • Unicode letters (Chinese, Arabic, Urdu, etc.) → KEPT ✓")
    print("  • Leading _ or - → Z (AUTO - always ON)")
    print("  • Reserved names (CON, PRN, AUX, etc.) → prefixed with _")
    print("  • NO COLLAPSING - every character stays as converted")
    print("\n" + "=" * 60)
    
    while True:
        print("\n" + "-" * 60)
        
        filename = input("📁 Enter filename (or 'quit' to exit): ").strip()
        
        if filename.lower() in ['quit', 'exit', 'q']:
            print("\nGoodbye! 👋")
            break
        
        if not filename:
            print("⚠️  Please enter a filename.")
            continue
        
        # REMOVED THE PROMPT - ALWAYS CONVERT LEADING
        convert_leading = True
        
        show_character_breakdown(filename)
        
        result = sanitize_filename(filename, convert_leading)
        
        print("\n" + "=" * 60)
        print("RESULTS")
        print("=" * 60)
        print(f"📝 Original:  {filename}")
        print(f"✅ Sanitized: {result}")
        
        if filename != result:
            print(f"🔀 Changed:   Yes")
            print(f"📊 Length:    {len(filename)} → {len(result)} characters")
            
            illegal_found = [c for c in filename if c in r'\\/*?:"<>|']
            if illegal_found:
                print(f"🚫 Illegal:   {', '.join(repr(c) for c in illegal_found)}")
            
            special_found = [c for c in filename if c in '!@#$%^&+={}[];\',~`']
            if special_found:
                display = ', '.join(repr(c) for c in special_found[:10])
                if len(special_found) > 10:
                    display += f" ... and {len(special_found) - 10} more"
                print(f"💠 Special:   {display}")
        else:
            print(f"🔀 Changed:   No (already valid)")
        
        print("=" * 60)
    
    wait_for_exit()


# ============================================================
# QUICK TEST MODE
# ============================================================
def quick_test():
    """Quick test mode"""
    
    test_filename = "!@#$%^&*()_+-={}[]b"
    
    print("=" * 60)
    print("QUICK TEST MODE")
    print("=" * 60)
    print(f"Testing: {test_filename}")
    print()
    
    show_character_breakdown(test_filename)
    
    result = sanitize_filename(test_filename, convert_leading=True)
    
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"📝 Original:  {test_filename}")
    print(f"✅ Sanitized: {result}")
    print(f"🔀 Changed:   {test_filename != result}")
    print(f"📊 Length:    {len(test_filename)} → {len(result)} characters")
    print("=" * 60)
    
    wait_for_exit()


# ============================================================
# JSON MODE - For programmatic use (e.g., Node.js integration)
# ============================================================
def json_mode(input_filename):
    """
    JSON mode for programmatic use.
    Accepts filename as argument, outputs JSON result.
    
    Usage: python3 sanitize.py --json "filename to sanitize"
    Output: {"sanitized": "clean-name", "original": "input", "success": true}
    """
    try:
        result = sanitize_filename(input_filename, convert_leading=True)
        
        output = {
            'sanitized': result,
            'original': input_filename,
            'success': True,
            'length': len(result)
        }
        
        print(json.dumps(output))
        return output
        
    except Exception as e:
        error_output = {
            'sanitized': None,
            'original': input_filename,
            'success': False,
            'error': str(e)
        }
        
        print(json.dumps(error_output))
        return error_output


# ============================================================
# ENTRY POINT
# ============================================================
if __name__ == "__main__":
    try:
        # Check for JSON mode first
        if len(sys.argv) > 1 and sys.argv[1] == '--json':
            # JSON mode: python3 sanitize.py --json "filename"
            if len(sys.argv) > 2:
                input_name = sys.argv[2]
                json_mode(input_name)
            else:
                # No filename provided, read from stdin
                input_name = sys.stdin.read().strip() if not sys.stdin.isatty() else ''
                if input_name:
                    json_mode(input_name)
                else:
                    print(json.dumps({
                        'sanitized': None,
                        'original': '',
                        'success': False,
                        'error': 'No filename provided'
                    }))
        elif len(sys.argv) > 1 and sys.argv[1] == '--test':
            quick_test()
        else:
            main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if sys.stdin.isatty() and '--json' not in sys.argv:
            wait_for_exit()