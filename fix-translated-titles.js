#!/usr/bin/env node
/**
 * fix-translated-titles.js — One-time script to fix 13 DB videos whose disk files
 * have translated titles (English in DB, Urdu on disk, or vice versa).
 *
 * This script:
 *   1. Reads db_channels.json
 *   2. Finds the 13 DB videos by their English finalFilename
 *   3. Updates finalFilename to the actual disk filename (Urdu)
 *   4. Sets downloadStatus = 'completed', syncStatus = 'downloaded'
 *   5. Saves the DB (creates a backup first)
 *
 * Usage:
 *   node fix-translated-titles.js                    # uses default db_channels.json path
 *   node fix-translated-titles.js /path/to/db.json  # custom path
 */

const fs = require('fs');
const path = require('path');

// ===== MANUAL MAPPING TABLE =====
// Each entry: { dbFilename (English, in DB), diskFilename (actual file on disk) }
const MAPPING = [
    {
        dbFilename: 'A Miracle Herb_ Reishi Mushroom Ganoderma and Shingraf for Vitality by Hakeem Ahmed Ali from Lahore.mp4',
        diskFilename: 'ایک اکسیری بوٹی ریشی مشروم گائناڈرما اور قوت باہ کے لیے اکسیری شنگرف حکیم احمد علی فرام لاہور_25-03-27.mp4'
    },
    {
        dbFilename: 'A Cure for Brain Weakness That Will Remove Your Glasses_ Tibiba Madam Iram Mursaleen.mp4',
        diskFilename: 'دماغی کمزوری کو دور کرنے کے لیے ایسا عمل جس سے چار نمبر عینک اتر جائے طبیبہ  میڈم ارم مرسلین_24-04-29.mp4'
    },
    {
        dbFilename: 'Practical Preparation of Virility-Boosting Cinnabar_ Verification Video.mp4',
        diskFilename: 'تصدیقی ویڈیو قوت باہ کے شنگرف کی تیاری پریکٹیکل_24-04-23.mp4'
    },
    {
        dbFilename: 'Successful treatment of white cataract and black cataract- not being able to see at night- by Hak.mp4',
        diskFilename: 'رات کو دکھائی نہ دینا سفید موتیا اور کالا موتیا کا کامیاب علاج حکیم باوا نعیم حیدر فرام فیصل اباد_24-03-08.mp4'
    },
    {
        dbFilename: 'Kidney pain will end soon- God willing- Ghulam Nabi Sanyasi from Faisalabad.mp4',
        diskFilename: 'درد گردہ فوری ختم انشاءاللہ تعالی غلام نبی سنیاسی فرام فیصل اباد_24-02-23.mp4'
    },
    {
        dbFilename: 'Solution for Weakness Caused by Diabetes and Its Complications by Hakeem Ghulam Nabi Sanyasi of F.mp4',
        diskFilename: 'شوگر سے پیدا ہونے والی کمزوری اور اس کے مسائل کا حل حکیم غلام نبی سنیاسی آف فیصل اباد_24-01-14.mp4'
    },
    {
        dbFilename: 'Video from India confirming the death of a dynasty-breaking cell.mp4',
        diskFilename: 'دینسٹی توڑنے والے سیل کے پارے کی تصدیقی ویڈیو انڈیا سے_23-11-09.mp4'
    },
    {
        dbFilename: 'A Miracle Herbal Formula for All Types of Hemorrhoids and Body Aches by Hakeem Ghulam Nabi Sanyas.mp4',
        diskFilename: 'ہر قسم کی بواسیر اور جسمانی دردوں کے لیے اکسیری ہربل فارمولاحکیم غلام نبی سنیاسی اف فیصل اباد_23-11-06.mp4'
    },
    {
        dbFilename: 'Identification of Narsal Herb- a Useful Remedy for Pregnancy- by Hakim Akhtar Sanyasi of Azad Kas.mp4',
        diskFilename: 'نرسل بوٹی کی پہچان جواستقرارحمل کے لیے ایک مفید دوا ہے حکیم اختر سنیاسی اف ازادکشمیر_23-10-29.mp4'
    },
    {
        dbFilename: 'Iron Liver Elixir- Special Speciality of Hakeem Afzal Ahmed Attari- Manuchak Manzi Bahauddin.mp4',
        diskFilename: 'اکسیر جگر فولادی خاص الخاص حکیم افضال احمد عطاری مانو چک منذی بہاؤالدین_23-09-15.mp4'
    },
    {
        dbFilename: 'کچے پارے کو رنگین کرنے کا مکمل عمل.mp4',
        diskFilename: 'The complete process of coloring raw mercury_23-09-13.mp4'
    },
    {
        dbFilename: 'Incomparable Silver Remedy for Diabetes- Erectile Dysfunction- and Azoospermia - Hakeem Nafees of.mp4',
        diskFilename: 'شوگر قوت باہ ایزوسپرمیا کے لئے لاجواب کشتہ چاندی -حکیم نفیس اف لاہور چاہ میراں_23-09-07.mp4'
    },
    {
        dbFilename: 'پتے کی درد فوری ختم سید حامد حسین اف شاہ کوٹ.mp4',
        diskFilename: 'Immediate Relief for Gallbladder Pain by Syed Hamid Hussain of Shahkot_23-12-23.mp4'
    },
];

// ===== MAIN =====
function main() {
    const dbPath = process.argv[2] || path.join(__dirname, 'db_channels.json');

    console.log('='.repeat(70));
    console.log('🔧 Fix Translated Titles — Manual Mapping Script');
    console.log('='.repeat(70));
    console.log('');
    console.log('DB path: ' + dbPath);
    console.log('Mappings to apply: ' + MAPPING.length);
    console.log('');

    // Read DB
    if (!fs.existsSync(dbPath)) {
        console.error('❌ DB file not found: ' + dbPath);
        process.exit(1);
    }

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log('✅ DB loaded: ' + db.length + ' channels');

    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = dbPath + '.bak.' + timestamp;
    fs.copyFileSync(dbPath, backupPath);
    console.log('📦 Backup created: ' + backupPath);
    console.log('');

    let fixed = 0;
    let notFound = 0;

    // Apply each mapping
    MAPPING.forEach((map, i) => {
        const dbFnLower = map.dbFilename.toLowerCase();
        let found = false;

        for (const ch of db) {
            const videos = ch.videos || [];
            for (const v of videos) {
                if (v.finalFilename && v.finalFilename.toLowerCase() === dbFnLower) {
                    console.log(`${i + 1}. ✅ Found in [${ch.name}]`);
                    console.log(`   Old: ${v.finalFilename}`);
                    console.log(`   New: ${map.diskFilename}`);

                    // Update the DB record
                    v.finalFilename = map.diskFilename;
                    v.downloadStatus = 'completed';
                    v.syncStatus = 'downloaded';

                    fixed++;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        if (!found) {
            console.log(`${i + 1}. ❌ NOT FOUND in DB: ${map.dbFilename.substring(0, 60)}...`);
            notFound++;
        }
        console.log('');
    });

    // Save DB
    if (fixed > 0) {
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
        console.log('='.repeat(70));
        console.log(`✅ Done! ${fixed} videos updated, ${notFound} not found`);
        console.log(`   DB saved to: ${dbPath}`);
        console.log(`   Backup at: ${backupPath}`);
        console.log('');
        console.log('Next steps:');
        console.log('  1. Restart your server: node server.js');
        console.log('  2. Click Sync Status — should now show 493/497 (or close to it)');
        console.log('='.repeat(70));
    } else {
        console.log('='.repeat(70));
        console.log('⚠️ No videos were updated (0 matches found)');
        console.log('='.repeat(70));
    }
}

main();
