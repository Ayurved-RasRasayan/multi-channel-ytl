const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
const keywords = ['Melting Mica','Mica','भटट','भट-ट-','पघल','प-घल','रहसयमय','रहस-यमय','सतव','सत-व','लइव','ल-इव','हलग','ह-इल-इट','Healing','Live'];
const stmt = db.prepare("SELECT id, title, finalFilename FROM videos WHERE title LIKE ?");
const seen = new Set();
for (const kw of keywords) {
  for (const row of stmt.all('%' + kw + '%')) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    console.log(row.id + '\t' + (row.finalFilename || '(no filename)') + '\t' + row.title);
  }
}
db.close();
