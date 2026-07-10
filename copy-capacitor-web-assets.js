// ينسخ ملفات JS الجاهزة (UMD) الخاصة بـ Capacitor Core وCapacitor Filesystem ومكتبة Excel (SheetJS)
// من node_modules إلى js/vendor/، لأن هذا المشروع لا يستخدم أي أداة تجميع (bundler) —
// وهي الطريقة الرسمية المدعومة من Capacitor للمشاريع الثابتة (Vanilla JS).
// يعمل تلقائياً بعد "npm install" (عبر postinstall في package.json).

const fs = require('fs');
const path = require('path');

const pairs = [
  { from: 'node_modules/@capacitor/core/dist/capacitor.js', to: 'js/vendor/capacitor.js' },
  { from: 'node_modules/@capacitor/filesystem/dist/plugin.js', to: 'js/vendor/capacitor-filesystem.js' },
  { from: 'node_modules/xlsx/dist/xlsx.full.min.js', to: 'js/vendor/xlsx.full.min.js' },
];

let missing = [];
for (const { from, to } of pairs) {
  const src = path.join(process.cwd(), from);
  const dest = path.join(process.cwd(), to);
  if (!fs.existsSync(src)) { missing.push(from); continue; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('نُسخ:', from, '->', to);
}

if (missing.length) {
  console.warn('تنبيه: لم يتم العثور على الملفات التالية (شغّل npm install أولاً):', missing.join(', '));
} else {
  console.log('تم تجهيز ملفات Capacitor بنجاح داخل js/vendor/');
}
