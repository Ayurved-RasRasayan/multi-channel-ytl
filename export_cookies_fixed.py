#!/usr/bin/env python3
"""
Fixed Cookie Extractor for Edge Browser
Extracts YouTube cookies from Edge's Network/Cookies database
"""

import os
import sys
import sqlite3
import shutil
from pathlib import Path

def extract_edge_cookies():
    """Extract cookies from Edge browser (Windows)"""
    edge_path = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data' / 'Default' / 'Network'
    cookie_db = edge_path / 'Cookies'
    
    if not cookie_db.exists():
        print(f"❌ Edge cookies database not found at: {cookie_db}")
        return None
    
    print(f"📁 Found edge cookies at: {cookie_db}")
    
    # Copy the database (Edge locks it)
    temp_db = Path('temp_cookies.db')
    try:
        shutil.copy2(cookie_db, temp_db)
        print("✅ Cookie database copied successfully")
    except Exception as e:
        print(f"❌ Failed to copy database: {e}")
        return None
    
    # Extract cookies for youtube.com
    conn = None
    cursor = None
    try:
        conn = sqlite3.connect(str(temp_db))
        cursor = conn.cursor()
        
        # Create cookies.txt in Netscape format
        with open('cookies.txt', 'w', encoding='utf-8') as f:
            f.write('# Netscape HTTP Cookie File\n')
            
            cursor.execute("""
                SELECT host_key, path, is_secure, expires_utc, name, value 
                FROM cookies 
                WHERE host_key LIKE '%youtube.com%' OR host_key LIKE '%google.com%'
            """)
            
            count = 0
            for row in cursor.fetchall():
                host, path, secure, expires, name, value = row
                # Convert Edge's timestamp to Unix time
                if expires > 0:
                    # Edge uses microseconds since 1601-01-01
                    expires_sec = int(expires / 1000000 - 11644473600)
                else:
                    expires_sec = 0
                
                secure_flag = 'TRUE' if secure else 'FALSE'
                f.write(f"{host}\t{secure_flag}\t{path}\t{secure_flag}\t{expires_sec}\t{name}\t{value}\n")
                count += 1
        
        print(f"✅ Extracted {count} cookies for youtube.com")
        return 'cookies.txt'
        
    except Exception as e:
        print(f"❌ Error extracting cookies: {e}")
        return None
    finally:
        # Close cursor and connection properly
        if cursor:
            cursor.close()
        if conn:
            conn.close()
        # Try to delete temp file
        try:
            if temp_db.exists():
                temp_db.unlink()
                print("✅ Temporary file cleaned up")
        except PermissionError:
            print("⚠️ Could not delete temp file (will be deleted on next restart)")

if __name__ == '__main__':
    print("🔍 Searching for browser cookies...")
    result = extract_edge_cookies()
    if result:
        print(f"✅ Cookies saved to: {result}")
        # Show the first few lines of the cookie file
        try:
            with open(result, 'r') as f:
                lines = f.readlines()
                print(f"\n📋 First few cookies (preview):")
                for line in lines[1:4]:  # Skip header
                    print(f"   {line.strip()[:80]}...")
        except:
            pass
        sys.exit(0)
    else:
        print("❌ Could not extract cookies from any browser")
        sys.exit(1)
