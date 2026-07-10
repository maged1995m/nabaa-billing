/* ============================================================
   نَبْع — نظام فوترة المشتركين (أوفلاين بالكامل)
   ============================================================ */

/* ---------- 1) طبقة التخزين ----------
   عند تشغيل التطبيق كتطبيق مثبَّت عبر Capacitor: تُحفظ البيانات كملف JSON فعلي داخل
   مساحة تخزين التطبيق الداخلية على الجهاز (Directory.Data) — وليس في ذاكرة المتصفح —
   عبر إضافة Capacitor Filesystem الرسمية. هذا يعني أن مسح "بيانات المتصفح" لا يمسح بياناتك.
   عند تشغيله كصفحة ويب عادية (اختبار قبل التحويل، أو داخل هذه المحادثة) يُستخدم localStorage
   كبديل مؤقت فقط، أو الذاكرة المؤقتة في وضع المعاينة. */
const CFG = window.APP_CONFIG || { PERSIST: false, AUTO_SEED: true };
const STORAGE_KEY = 'nabaa_billing_db_v1';
const DB_FILE_NAME = 'nabaa_billing_db.json';

const MemoryBackend = (() => {
  let data = null;
  return {
    kind: 'memory',
    async load(){ return data; },
    async save(obj){ data = obj; }
  };
})();

const LocalStorageBackend = {
  kind: 'localStorage',
  async load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ console.warn('تعذر القراءة من تخزين المتصفح', e); return null; }
  },
  async save(obj){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
    catch(e){ console.warn('تعذر الحفظ في تخزين المتصفح', e); }
  }
};

/* تخزين حقيقي على جهاز المستخدم عبر Capacitor Filesystem (يعمل فقط داخل تطبيق مثبَّت مبني بـ Capacitor).
   نستخدم القيم النصية الفعلية ('DATA' و'utf8') بدل استيراد رموز Directory/Encoding، لأن هذه
   الرموز جزء من حزمة npm الخاصة بالمطوّرين (TypeScript) وليست بالضرورة متاحة على كائن الجسر
   window.Capacitor.Plugins في مشروع بدون Bundler — بينما القيم النصية تعمل دائماً وبشكل مباشر.
   ملفا js/vendor/capacitor.js وjs/vendor/capacitor-filesystem.js يُنسخان تلقائياً من node_modules
   عبر "npm install" (راجع scripts/copy-capacitor-web-assets.js وREADME، القسم 2). */
const NativeFilesystemBackend = {
  kind: 'device',
  async load(){
    try{
      const { Filesystem } = window.Capacitor.Plugins;
      const res = await Filesystem.readFile({ path: DB_FILE_NAME, directory: 'DATA', encoding: 'utf8' });
      return JSON.parse(res.data);
    }catch(e){
      return null; // أول تشغيل — الملف غير موجود بعد
    }
  },
  async save(obj){
    try{
      const { Filesystem } = window.Capacitor.Plugins;
      await Filesystem.writeFile({ path: DB_FILE_NAME, directory: 'DATA', data: JSON.stringify(obj), encoding: 'utf8' });
    }catch(e){
      console.warn('تعذر الحفظ في تخزين الجهاز، سيُستخدم تخزين المتصفح كبديل', e);
      LocalStorageBackend.save(obj);
    }
  }
};

function isRunningInsideCapacitorApp(){
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem);
}

function detectBackend(){
  if(!CFG.PERSIST) return MemoryBackend;                 // وضع المعاينة داخل المحادثة
  if(isRunningInsideCapacitorApp()) return NativeFilesystemBackend; // تطبيق مثبَّت فعلياً على الجهاز
  return LocalStorageBackend;                              // متصفح عادي (اختبار قبل التحويل لتطبيق)
}

const Backend = detectBackend();
window.__NABAA_STORAGE_KIND = Backend.kind; // للتشخيص فقط: 'device' | 'localStorage' | 'memory'

function emptyDB(){
  return {
    settings: {
      org_name: 'مؤسسة نبع لخدمات المياه',
      org_sub: 'إدارة المشتركين والفوترة الشهرية',
      currency: 'ريال',
      next_ids: { subscribers:1, types:1, cycles:1, readings:1, areas:1, squares:1, collectors:1, users:2, payments:1 }
    },
    subscription_types: [],
    subscribers: [],
    cycles: [],
    readings: [],
    areas: [],
    squares: [],
    collectors: [],
    payments: [],
    // مستخدم افتراضي واحد بصلاحية مدير — الرقم السري الافتراضي 1234 (يمكن تغييره من شاشة المستخدمين)
    users: [ { id:1, username:'admin', full_name:'مدير النظام', pin:'1234', role:'admin', is_active:true } ]
  };
}

let DB = emptyDB(); // قيمة مؤقتة ريثما يكتمل التحميل الفعلي (غير متزامن) في init()
let DB_LOADED = false;

async function loadDB(){
  try{
    const loaded = await Backend.load();
    DB = loaded || emptyDB();
  }catch(e){
    console.warn('تعذر تحميل البيانات المحفوظة، سيبدأ التطبيق بقاعدة بيانات فارغة', e);
    DB = emptyDB();
  }
  DB_LOADED = true;
}

async function persist(){
  try{ await Backend.save(DB); }
  catch(e){ console.warn('تعذر حفظ البيانات', e); toast && toast('تعذر حفظ البيانات على الجهاز', 'error'); }
}

function nextId(table){
  const n = DB.settings.next_ids[table] || 1;
  DB.settings.next_ids[table] = n + 1;
  return n;
}

/* ---------- 2) أدوات مساعدة عامة ---------- */
function fmtMoney(n){
  n = Number(n) || 0;
  return n.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
}
function fmtDate(d){
  if(!d) return '—';
  const dt = new Date(d);
  if(isNaN(dt)) return d;
  return dt.toLocaleDateString('ar-EG', {year:'numeric', month:'short', day:'2-digit'});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function esc(s){
  if(s===null||s===undefined) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(prefix){ return prefix + '-' + Math.random().toString(36).slice(2,8); }

function toast(msg, type){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; el.style.transition='all .2s'; setTimeout(()=>el.remove(), 200); }, 2600);
}

function icon(name){
  const icons = {
    dashboard:'<path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 3v6h8V3h-8Z"/>',
    subscribers:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="18" cy="8.5" r="2.3"/><path d="M15.7 14c2.8.3 4.8 2.4 4.8 5.4"/>',
    types:'<path d="M3 7h18M3 12h18M3 17h10"/>',
    cycles:'<path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 21v-5h5"/>',
    readings:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 3v3M16 3v3M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
    invoices:'<path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>',
    reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    print:'<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7"/><path d="M6 14H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"/>',
    cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v.01M18 14v.01"/>',
    lock:'<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock:'<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.4-2"/>',
    empty:'<path d="M3 7h18v13H3z"/><path d="M3 7l9-4 9 4"/><path d="M9 12h6"/>',
    download:'<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    upload:'<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
    close:'<path d="M18 6 6 18M6 6l12 12"/>',
    check:'<path d="m5 13 4 4L19 7"/>',
    filter:'<path d="M4 5h16l-6 8v6l-4-2v-4Z"/>',
    droplet:'<path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"/>',
    map:'<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>',
    userCheck:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5S15.5 16.4 15.5 20"/><path d="m17.5 11 2 2 3.5-3.5"/>',
    shield:'<path d="M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name]||''}</svg>`;
}

/* ---------- 3) بذور بيانات تجريبية (للمعاينة فقط) ---------- */
function seedDemoData(){
  const typeH = { id: nextId('types'), type_name:'منزلي', monthly_fee:300, unit_price:500, is_active:true };
  const typeC = { id: nextId('types'), type_name:'تجاري', monthly_fee:500, unit_price:350, is_active:true };
  DB.subscription_types.push(typeH, typeC);

  const areaN = { id: nextId('areas'), area_name:'حي النور' };
  const areaS = { id: nextId('areas'), area_name:'حي السلام' };
  DB.areas.push(areaN, areaS);
  const sq1 = { id: nextId('squares'), square_name:'مربع 1', area_id:areaN.id };
  const sq2 = { id: nextId('squares'), square_name:'مربع 2', area_id:areaN.id };
  const sq3 = { id: nextId('squares'), square_name:'مربع 1', area_id:areaS.id };
  DB.squares.push(sq1, sq2, sq3);

  const col1 = { id: nextId('collectors'), collector_name:'صالح المتحصل', phone:'777123456', is_active:true };
  DB.collectors.push(col1);

  DB.users.push(
    { id: nextId('users'), username:'reader', full_name:'سالم قارئ العداد', pin:'1111', role:'reader', is_active:true },
    { id: nextId('users'), username:'collector', full_name:'صالح المتحصل', pin:'2222', role:'collector', is_active:true }
  );

  const names = ['محمد عبدالله الخطابي','داود الصغير طه','غالب بن عبدالله','علي حسن الخطابي','يوسف محسن ناصر','بشير عبده محمد','وردة حسن صغير','مختار محمد مراد','علي مرشد الحوري','مهدي احمد بركة','محل الأمانة التجاري','صيدلية الشفاء'];
  const squarePlan = [sq1.id,sq1.id,sq1.id,sq2.id,sq2.id,sq2.id,sq3.id,sq3.id,sq3.id,sq1.id,sq2.id,sq3.id];
  names.forEach((name, i)=>{
    const isShop = name.includes('محل') || name.includes('صيدلية');
    const sq = DB.squares.find(s=>s.id===squarePlan[i]);
    const sub = {
      id: nextId('subscribers'),
      subscriber_number: 'SUB-' + String(1000+i),
      subscriber_name: name,
      meter_number: '1_' + (24+i),
      subscription_type_id: isShop ? typeC.id : typeH.id,
      area_id: sq ? sq.area_id : null,
      square_id: sq ? sq.id : null,
      phone:'', address:'', status:'active',
      last_reading_value: 20 + i*35,
      last_balance: [0,0,4500,0,12000,0,0,3200,0,0,17000,0][i] || 0,
      join_date:'2025-01-01', notes:''
    };
    DB.subscribers.push(sub);
  });

  const closedCycle = { id: nextId('cycles'), cycle_name:'مارس وأبريل 2026', start_date:'2026-03-01', end_date:'2026-04-30', reader_name:'صالح', status:'closed' };
  const openCycle = { id: nextId('cycles'), cycle_name:'دورة مايو 2026', start_date:'2026-05-01', end_date:'2026-05-31', reader_name:'صالح', status:'open' };
  DB.cycles.push(closedCycle, openCycle);

  // إنشاء قراءات وفواتير للدورة المغلقة لجميع المشتركين، مع دفعات جزئية عشوائية عبر سجل الدفعات
  DB.subscribers.forEach((sub, i)=>{
    const type = DB.subscription_types.find(t=>t.id===sub.subscription_type_id);
    const prev = Math.max(0, sub.last_reading_value - (30+i*4));
    const curr = sub.last_reading_value;
    const reading = buildReading(sub, closedCycle, type, prev, curr, 0, 0);
    recalcReading(reading);
    DB.readings.push(reading);
    const paidRatio = [1,1,0.5,1,0,1,1,0.3,1,1,0,1][i] ?? 1;
    const amount = Math.round(reading.amount_due * paidRatio);
    if(amount > 0){
      DB.payments.push({ id: nextId('payments'), reading_id: reading.id, subscriber_id: sub.id, collector_id: col1.id, amount, date: closedCycle.end_date, notes:'', created_at: new Date().toISOString() });
      recomputeAmountPaid(reading);
    }
  });

  // ترحيل الأرصدة كما لو أُغلقت الدورة فعلاً
  DB.subscribers.forEach(sub=>{
    const r = DB.readings.find(r=>r.subscriber_id===sub.id && r.cycle_id===closedCycle.id);
    if(r){ sub.last_reading_value = r.current_reading; sub.last_balance = r.remaining_amount; }
  });
}

/* بناء كائن قراءة/فاتورة جديد (بدون حفظ) */
function buildReading(sub, cycle, type, prevReading, currReading, estimated, arrearsOverride){
  const seq = DB.readings.filter(r=>r.cycle_id===cycle.id).length + 1;
  return {
    id: nextId('readings'),
    subscriber_id: sub.id,
    cycle_id: cycle.id,
    invoice_number: 'INV-' + cycle.id + '-' + String(seq).padStart(4,'0'),
    previous_reading: prevReading,
    current_reading: currReading,
    estimated_units: estimated || 0,
    unit_price: type ? type.unit_price : 0,
    monthly_fee: type ? type.monthly_fee : 0,
    arrears: arrearsOverride !== undefined ? arrearsOverride : (sub.last_balance || 0),
    settlement_amount: 0,
    settlement_reason: '',
    amount_paid: 0,
    status: 'unpaid',
    notes: '',
    created_at: new Date().toISOString()
  };
}

/* إعادة حساب الحقول المشتقة لسجل قراءة (يحاكي الأعمدة GENERATED في MySQL) */
function recalcReading(r){
  r.reading_difference = Math.max(0, r.current_reading - r.previous_reading);
  r.total_consumed_units = r.reading_difference + (r.estimated_units||0);
  r.consumption_amount = r.total_consumed_units * r.unit_price;
  r.amount_due = r.consumption_amount + r.monthly_fee + (r.arrears||0) - (r.settlement_amount||0);
  r.remaining_amount = r.amount_due - (r.amount_paid||0);
  if(r.remaining_amount <= 0.001) r.status = 'paid';
  else if((r.amount_paid||0) > 0) r.status = 'partial';
  else r.status = 'unpaid';
  return r;
}

/* دوال سجل الدفعات — كل دفعة (كاملة أو جزئية) تُسجَّل هنا مع المتحصل الذي استلمها */
function paymentsForReading(readingId){
  return DB.payments.filter(p=>p.reading_id===readingId);
}
function recomputeAmountPaid(reading){
  reading.amount_paid = paymentsForReading(reading.id).reduce((s,p)=>s+Number(p.amount||0),0);
  recalcReading(reading);
}
function recordPayment(reading, amount, collectorId, notes){
  DB.payments.push({
    id: nextId('payments'), reading_id: reading.id, subscriber_id: reading.subscriber_id,
    collector_id: collectorId || null, amount: Number(amount)||0, date: todayISO(),
    notes: notes || '', created_at: new Date().toISOString()
  });
  recomputeAmountPaid(reading);
}

/* توليد QR كرمز SVG داخلي (يكبر رقم النوع تلقائياً حتى تسع البيانات) */
function generateQRSvg(text, cellSize){
  for(let t=3; t<=12; t++){
    try{
      const qr = qrcode(t, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag(cellSize||3, 4);
    }catch(e){ /* جرّب رقم نوع أكبر */ }
  }
  return '';
}

/* ---------- 4) التنقل بين الشاشات ---------- */
const NAV = [
  { group:'عام', items:[
    { id:'dashboard', label:'لوحة التحكم', icon:'dashboard', roles:['admin','reader','collector'] },
  ]},
  { group:'البيانات', items:[
    { id:'subscribers', label:'المشتركون', icon:'subscribers', roles:['admin'] },
    { id:'types', label:'أنواع الاشتراك', icon:'types', roles:['admin'] },
    { id:'areas', label:'المناطق والمربعات', icon:'map', roles:['admin'] },
    { id:'cycles', label:'الدورات', icon:'cycles', roles:['admin'] },
  ]},
  { group:'الفوترة', items:[
    { id:'readings', label:'إدخال القراءات', icon:'readings', roles:['admin','reader'] },
    { id:'invoices', label:'الفواتير والدفعات', icon:'invoices', roles:['admin','collector'] },
  ]},
  { group:'أخرى', items:[
    { id:'reports', label:'التقارير', icon:'reports', roles:['admin','collector'] },
    { id:'collectors', label:'المتحصلون', icon:'userCheck', roles:['admin'] },
    { id:'users', label:'المستخدمون', icon:'shield', roles:['admin'] },
    { id:'settings', label:'الإعدادات', icon:'settings', roles:['admin'] },
  ]}
];

const PAGE_META = {
  dashboard:['لوحة التحكم','نظرة عامة على الاشتراكات والدورة الحالية'],
  subscribers:['المشتركون','إدارة بيانات المشتركين والعدادات'],
  types:['أنواع الاشتراك','تعريف فئات الاشتراك وأسعار الوحدة'],
  areas:['المناطق والمربعات','تقسيم المشتركين جغرافياً لتسهيل جولات القراءة والتحصيل'],
  cycles:['الدورات','إدارة دورات القراءة الشهرية وإغلاقها'],
  readings:['إدخال القراءات','تسجيل قراءة العداد لإصدار الفاتورة تلقائياً'],
  invoices:['الفواتير والدفعات','متابعة فواتير الدورة وتسجيل الدفعات'],
  reports:['التقارير','متأخرات، فواتير غير مسددة، استهلاك، وكشوف المتحصلين'],
  collectors:['المتحصلون','إدارة فريق تحصيل الدفعات الميداني'],
  users:['المستخدمون','حسابات الدخول وصلاحيات كل دور'],
  settings:['الإعدادات','بيانات المنشأة والنسخ الاحتياطي']
};

let CURRENT_VIEW = 'dashboard';
let CURRENT_USER = null;

function visibleNavGroups(){
  const role = CURRENT_USER ? CURRENT_USER.role : 'admin';
  return NAV.map(g => ({ group:g.group, items: g.items.filter(it => it.roles.includes(role)) }))
             .filter(g => g.items.length);
}

function renderNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = visibleNavGroups().map(g => `
    <div class="nav-group-label">${g.group}</div>
    ${g.items.map(it => `
      <button class="nav-item ${it.id===CURRENT_VIEW?'active':''}" data-view="${it.id}">
        ${icon(it.icon)}<span>${it.label}</span>
      </button>
    `).join('')}
  `).join('');
  nav.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=> navigate(btn.dataset.view));
  });
  renderSidebarFoot();
}

function renderSidebarFoot(){
  const foot = document.getElementById('sidebarFoot');
  if(!foot) return;
  const roleLabels = { admin:'مدير النظام', reader:'قارئ عدادات', collector:'متحصل' };
  if(CURRENT_USER){
    foot.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="overflow:hidden;">
          <div style="color:#EAF3F2; font-weight:700; font-size:12px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${esc(CURRENT_USER.full_name)}</div>
          <div>${roleLabels[CURRENT_USER.role]||CURRENT_USER.role}</div>
        </div>
        <button class="btn btn-icon btn-ghost" id="logoutBtn" style="color:#CFE4E2; flex-shrink:0;" title="تسجيل خروج">${icon('logout')}</button>
      </div>
    `;
    const btn = document.getElementById('logoutBtn');
    if(btn) btn.addEventListener('click', logout);
  }else{
    foot.textContent = 'يعمل بدون إنترنت — بياناتك محفوظة على جهازك فقط';
  }
}

function navigate(view){
  const role = CURRENT_USER ? CURRENT_USER.role : 'admin';
  const allowed = NAV.some(g => g.items.some(it => it.id===view && it.roles.includes(role)));
  if(!allowed) view = 'dashboard';
  CURRENT_VIEW = view;
  document.getElementById('sidebar').classList.remove('open');
  renderNav();
  const [title, sub] = PAGE_META[view];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSub').textContent = sub;
  renderCyclePill();
  const content = document.getElementById('content');
  content.innerHTML = '<div class="view active" id="viewRoot"></div>';
  const root = document.getElementById('viewRoot');
  const renderers = {
    dashboard: renderDashboard, subscribers: renderSubscribers, types: renderTypes,
    areas: renderAreas, cycles: renderCycles, readings: renderReadings, invoices: renderInvoices,
    reports: renderReports, collectors: renderCollectors, users: renderUsers, settings: renderSettings
  };
  (renderers[view] || renderDashboard)(root);
}

function renderCyclePill(){
  const pill = document.getElementById('cyclePill');
  const openCycle = DB.cycles.find(c=>c.status==='open');
  const text = document.getElementById('cyclePillText');
  if(openCycle){
    pill.classList.remove('closed');
    text.textContent = 'الدورة المفتوحة: ' + openCycle.cycle_name;
  }else{
    pill.classList.add('closed');
    text.textContent = 'لا توجد دورة مفتوحة حالياً';
  }
}

document.getElementById('menuToggle').addEventListener('click', ()=>{
  document.getElementById('sidebar').classList.toggle('open');
});

/* ---------- 5) نوافذ منبثقة عامة ---------- */
function openModal(html, opts){
  opts = opts || {};
  const modal = document.getElementById('modal');
  modal.className = 'modal' + (opts.wide ? ' wide' : '');
  modal.innerHTML = html;
  document.getElementById('overlay').classList.add('open');
  const closers = modal.querySelectorAll('[data-close]');
  closers.forEach(b=> b.addEventListener('click', closeModal));
}
function closeModal(){
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('modal').innerHTML = '';
}
document.getElementById('overlay').addEventListener('click', (e)=>{
  if(e.target.id === 'overlay') closeModal();
});
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

function confirmDialog(message, onConfirm){
  openModal(`
    <div class="modal-head"><h3>تأكيد الإجراء</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body"><p style="margin:0; font-size:13.5px; line-height:1.7;">${esc(message)}</p></div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-danger" id="confirmBtn">تأكيد الحذف</button>
    </div>
  `);
  document.getElementById('confirmBtn').addEventListener('click', ()=>{ onConfirm(); closeModal(); });
}

/* ---------- 6) لوحة التحكم ---------- */
function renderDashboard(root){
  if(!DB.subscribers.length && !DB.subscription_types.length){
    root.innerHTML = `
      <div class="card">
        <div class="empty" style="padding:70px 20px;">
          ${icon('droplet')}
          <b>ابدأ باستخدام نظام نبع</b>
          <span>لا توجد بيانات بعد. أضف أنواع الاشتراك ثم المشتركين، أو جرّب بيانات تجريبية جاهزة لاستكشاف النظام</span>
          <div style="display:flex; gap:8px; justify-content:center; margin-top:18px;">
            <button class="btn btn-primary" onclick="navigate('types')">${icon('plus')} البدء يدوياً</button>
            <button class="btn" id="loadDemoBtn">${icon('readings')} تحميل بيانات تجريبية</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('loadDemoBtn').addEventListener('click', ()=>{
      seedDemoData(); persist(); toast('تم تحميل بيانات تجريبية', 'success'); navigate('dashboard');
    });
    return;
  }
  const openCycle = DB.cycles.find(c=>c.status==='open');
  const totalSubs = DB.subscribers.length;
  const activeSubs = DB.subscribers.filter(s=>s.status==='active').length;
  const cycleReadings = openCycle ? DB.readings.filter(r=>r.cycle_id===openCycle.id) : [];
  const doneCount = cycleReadings.length;
  const pct = totalSubs ? Math.round((doneCount/totalSubs)*100) : 0;
  const totalDue = cycleReadings.reduce((s,r)=>s+r.amount_due,0);
  const totalPaid = cycleReadings.reduce((s,r)=>s+r.amount_paid,0);
  const totalRemain = totalDue - totalPaid;
  const totalArrears = DB.subscribers.reduce((s,sub)=>s+(Number(sub.last_balance)||0),0);

  const gaugeDeg = Math.min(180, pct*1.8);

  root.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat">
        <div class="label">${icon('subscribers')} إجمالي المشتركين</div>
        <div class="value">${totalSubs}</div>
        <div class="foot">${activeSubs} نشط حالياً</div>
      </div>
      <div class="card stat accent-amber">
        <div class="label">${icon('cash')} مستحق الدورة الحالية</div>
        <div class="value">${fmtMoney(totalDue)}</div>
        <div class="foot">${openCycle ? openCycle.cycle_name : 'لا توجد دورة مفتوحة'}</div>
      </div>
      <div class="card stat accent-success">
        <div class="label">${icon('check')} محصّل الدورة الحالية</div>
        <div class="value">${fmtMoney(totalPaid)}</div>
        <div class="foot">${totalDue ? Math.round(totalPaid/totalDue*100) : 0}% من المستحق</div>
      </div>
      <div class="card stat accent-danger">
        <div class="label">${icon('reports')} إجمالي المتأخرات المرحّلة</div>
        <div class="value">${fmtMoney(totalArrears)}</div>
        <div class="foot">من الدورات السابقة</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <h3>تقدّم القراءات — ${openCycle ? esc(openCycle.cycle_name) : 'لا توجد دورة مفتوحة'}</h3>
          <span class="hint">${doneCount} / ${totalSubs} مشترك</span>
        </div>
        <div class="card-pad">
          ${!openCycle ? `
            <div class="empty">${icon('cycles')}<b>لا توجد دورة قراءة مفتوحة</b><span>افتح دورة جديدة من شاشة «الدورات» لبدء تسجيل القراءات</span></div>
          `:`
          <div class="gauge-wrap">
            <svg width="120" height="70" viewBox="0 0 120 70">
              <path d="M10 65 A50 50 0 0 1 110 65" stroke="#EFEBE0" stroke-width="12" fill="none" stroke-linecap="round"/>
              <path d="M10 65 A50 50 0 0 1 110 65" stroke="#1F8A8C" stroke-width="12" fill="none" stroke-linecap="round"
                stroke-dasharray="${(pct/100)*157} 157"/>
              <g transform="translate(60,65) rotate(${-90+gaugeDeg})"><line x1="0" y1="0" x2="0" y2="-42" stroke="#D98E3B" stroke-width="3" stroke-linecap="round"/></g>
              <circle cx="60" cy="65" r="4" fill="#123B44"/>
            </svg>
            <div class="gauge-info"><b>${pct}%</b><span>من المشتركين تم تسجيل قراءتهم لهذه الدورة</span></div>
          </div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn btn-primary" onclick="navigate('readings')">${icon('readings')} متابعة إدخال القراءات</button>
            <button class="btn" onclick="navigate('invoices')">${icon('invoices')} عرض فواتير الدورة</button>
          </div>
          `}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>الأكثر مديونية</h3><span class="hint">أعلى 5 أرصدة</span></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>المشترك</th><th>الرصيد</th></tr></thead>
            <tbody>
              ${topDebtors().map(s=>`<tr><td>${esc(s.subscriber_name)}</td><td class="num" style="color:var(--danger)">${fmtMoney(s.last_balance)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted" style="text-align:center; padding:20px;">لا توجد بيانات</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}
function topDebtors(){
  return [...DB.subscribers].filter(s=>Number(s.last_balance)>0).sort((a,b)=>b.last_balance-a.last_balance).slice(0,5);
}

/* ---------- 7) المشتركون ---------- */
let subSearchTerm = '';
function renderSubscribers(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>المشتركون</h2><p>${DB.subscribers.length} مشترك مسجّل</p></div>
      <div class="view-actions">
        <button class="btn btn-primary" id="addSubBtn">${icon('plus')} إضافة مشترك</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-box">${icon('search')}<input type="search" id="subSearch" placeholder="ابحث بالاسم، رقم المشترك، أو رقم العداد..." value="${esc(subSearchTerm)}"></div>
      <select id="subAreaFilter" style="max-width:200px;">
        <option value="all">كل المناطق</option>
        ${DB.areas.map(a=>`<option value="${a.id}" ${subAreaFilter===String(a.id)?'selected':''}>${esc(a.area_name)}</option>`).join('')}
      </select>
      <label class="btn" style="cursor:pointer;">${icon('upload')} استيراد من Excel<input type="file" id="xlsxImportInput" accept=".xlsx,.xls" style="display:none;"></label>
      <button class="btn" id="xlsxTemplateBtn">${icon('download')} قالب Excel</button>
      <button class="btn" id="xlsxExportBtn">${icon('download')} تصدير الكل Excel</button>
    </div>
    <div class="card"><div class="table-scroll" id="subTableWrap"></div></div>
  `;
  document.getElementById('addSubBtn').addEventListener('click', ()=>openSubscriberForm());
  document.getElementById('subSearch').addEventListener('input', (e)=>{ subSearchTerm = e.target.value; renderSubTable(); });
  document.getElementById('subAreaFilter').addEventListener('change', (e)=>{ subAreaFilter = e.target.value; renderSubTable(); });
  document.getElementById('xlsxTemplateBtn').addEventListener('click', downloadXlsxTemplate);
  document.getElementById('xlsxExportBtn').addEventListener('click', downloadSubscribersXlsx);
  document.getElementById('xlsxImportInput').addEventListener('change', handleXlsxImport);
  renderSubTable();
}

let subAreaFilter = 'all';
function renderSubTable(){
  const wrap = document.getElementById('subTableWrap');
  const term = subSearchTerm.trim().toLowerCase();
  let list = DB.subscribers;
  if(term){
    list = list.filter(s => (s.subscriber_name||'').toLowerCase().includes(term) || (s.subscriber_number||'').toLowerCase().includes(term) || (s.meter_number||'').toLowerCase().includes(term));
  }
  if(subAreaFilter!=='all') list = list.filter(s=>String(s.area_id)===subAreaFilter);
  if(!list.length){
    wrap.innerHTML = `<div class="empty">${icon('subscribers')}<b>لا يوجد مشتركون</b><span>ابدأ بإضافة أول مشترك في النظام</span></div>`;
    return;
  }
  const statusMap = { active:['نشط','badge-success'], inactive:['متوقف','badge-muted'], disconnected:['مفصول','badge-danger'], pending:['معلق','badge-amber'] };
  wrap.innerHTML = `
    <table>
      <thead><tr><th>رقم المشترك</th><th>الاسم</th><th>رقم العداد</th><th>نوع الاشتراك</th><th>المنطقة/المربع</th><th>آخر قراءة</th><th>الرصيد</th><th>الحالة</th><th></th></tr></thead>
      <tbody>
        ${list.map(s=>{
          const type = DB.subscription_types.find(t=>t.id===s.subscription_type_id);
          const area = DB.areas.find(a=>a.id===s.area_id);
          const square = DB.squares.find(sq=>sq.id===s.square_id);
          const st = statusMap[s.status] || statusMap.active;
          return `<tr>
            <td class="num">${esc(s.subscriber_number)}</td>
            <td>${esc(s.subscriber_name)}</td>
            <td class="num muted">${esc(s.meter_number||'—')}</td>
            <td>${type ? esc(type.type_name) : '<span class="muted">—</span>'}</td>
            <td class="muted">${area?esc(area.area_name):'—'}${square?' / '+esc(square.square_name):''}</td>
            <td class="num">${s.last_reading_value}</td>
            <td class="num" style="${s.last_balance>0?'color:var(--danger)':''}">${fmtMoney(s.last_balance)}</td>
            <td><span class="badge ${st[1]}">${st[0]}</span></td>
            <td>
              <button class="btn btn-sm btn-ghost" onclick="openSubscriberForm(${s.id})">${icon('edit')}</button>
              <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteSubscriber(${s.id})">${icon('trash')}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function openSubscriberForm(id){
  const editing = DB.subscribers.find(s=>s.id===id);
  const typesOpts = DB.subscription_types.map(t=>`<option value="${t.id}" ${editing&&editing.subscription_type_id===t.id?'selected':''}>${esc(t.type_name)} (${fmtMoney(t.unit_price)}/وحدة)</option>`).join('');
  if(!DB.subscription_types.length){ toast('أضف نوع اشتراك واحداً على الأقل أولاً', 'error'); navigate('types'); return; }
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل بيانات مشترك':'إضافة مشترك جديد'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>اسم المشترك</label><input type="text" id="f_name" value="${editing?esc(editing.subscriber_name):''}" placeholder="مثال: محمد أحمد علي"></div>
        <div class="field"><label>رقم العداد</label><input type="text" id="f_meter" value="${editing?esc(editing.meter_number||''):''}" placeholder="مثال: 1_24"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>نوع الاشتراك</label><select id="f_type">${typesOpts}</select></div>
        <div class="field"><label>حالة المشترك</label>
          <select id="f_status">
            <option value="active" ${editing&&editing.status==='active'?'selected':''}>نشط</option>
            <option value="inactive" ${editing&&editing.status==='inactive'?'selected':''}>متوقف</option>
            <option value="disconnected" ${editing&&editing.status==='disconnected'?'selected':''}>مفصول</option>
            <option value="pending" ${editing&&editing.status==='pending'?'selected':''}>معلق</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>المنطقة (اختياري)</label>
          <select id="f_area">
            <option value="">بدون</option>
            ${DB.areas.map(a=>`<option value="${a.id}" ${editing&&editing.area_id===a.id?'selected':''}>${esc(a.area_name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>المربع (اختياري)</label><select id="f_square"><option value="">بدون</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>آخر قراءة مرحّلة</label><input type="number" id="f_last_reading" value="${editing?editing.last_reading_value:0}" min="0"></div>
        <div class="field"><label>رصيد سابق مرحّل (متأخرات)</label><input type="number" id="f_last_balance" value="${editing?editing.last_balance:0}" min="0"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>رقم الهاتف (اختياري)</label><input type="tel" id="f_phone" value="${editing?esc(editing.phone||''):''}"></div>
        <div class="field"><label>تاريخ الاشتراك</label><input type="date" id="f_join" value="${editing?editing.join_date||'':todayISO()}"></div>
      </div>
      <div class="field"><label>العنوان / ملاحظات</label><textarea id="f_notes">${editing?esc(editing.notes||''):''}</textarea></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="saveSubBtn">${icon('check')} حفظ</button>
    </div>
  `);
  function fillSquareOptions(areaId, selectedSquareId){
    const sel = document.getElementById('f_square');
    const squares = DB.squares.filter(sq=>String(sq.area_id)===String(areaId));
    sel.innerHTML = '<option value="">بدون</option>' + squares.map(sq=>`<option value="${sq.id}" ${selectedSquareId===sq.id?'selected':''}>${esc(sq.square_name)}</option>`).join('');
  }
  fillSquareOptions(editing?editing.area_id:'', editing?editing.square_id:null);
  document.getElementById('f_area').addEventListener('change', (e)=> fillSquareOptions(e.target.value, null));

  document.getElementById('saveSubBtn').addEventListener('click', ()=>{
    const name = document.getElementById('f_name').value.trim();
    if(!name){ toast('يرجى إدخال اسم المشترك', 'error'); return; }
    const payload = {
      subscriber_name: name,
      meter_number: document.getElementById('f_meter').value.trim(),
      subscription_type_id: Number(document.getElementById('f_type').value),
      status: document.getElementById('f_status').value,
      area_id: document.getElementById('f_area').value ? Number(document.getElementById('f_area').value) : null,
      square_id: document.getElementById('f_square').value ? Number(document.getElementById('f_square').value) : null,
      last_reading_value: Number(document.getElementById('f_last_reading').value)||0,
      last_balance: Number(document.getElementById('f_last_balance').value)||0,
      phone: document.getElementById('f_phone').value.trim(),
      join_date: document.getElementById('f_join').value,
      notes: document.getElementById('f_notes').value.trim(),
    };
    if(editing){
      Object.assign(editing, payload);
      toast('تم تحديث بيانات المشترك', 'success');
    }else{
      const id = nextId('subscribers');
      DB.subscribers.push(Object.assign({ id, subscriber_number:'SUB-'+String(1000+id), address:'' }, payload));
      toast('تمت إضافة المشترك بنجاح', 'success');
    }
    persist(); closeModal(); renderSubTable();
    if(CURRENT_VIEW==='subscribers') document.querySelector('.view-head p').textContent = DB.subscribers.length + ' مشترك مسجّل';
  });
}

function deleteSubscriber(id){
  const hasReadings = DB.readings.some(r=>r.subscriber_id===id);
  confirmDialog(hasReadings ? 'هذا المشترك لديه فواتير مسجّلة، سيتم حذف بياناته فقط وليس الفواتير. هل تريد المتابعة؟' : 'سيتم حذف هذا المشترك نهائياً. هل أنت متأكد؟', ()=>{
    DB.subscribers = DB.subscribers.filter(s=>s.id!==id);
    persist(); toast('تم حذف المشترك', 'success'); renderSubscribers(document.getElementById('viewRoot'));
  });
}

/* ---------- 7ب) استيراد/تصدير Excel (xlsx) للمشتركين ---------- */
const XLSX_HEADERS = ['اسم المشترك','رقم العداد','نوع الاشتراك','المنطقة','المربع','آخر قراءة','رصيد سابق','الهاتف'];
function isXlsxReady(){
  return typeof XLSX !== 'undefined' && XLSX && XLSX.utils;
}
function downloadXlsxTemplate(){
  if(!isXlsxReady()){ toast('مكتبة Excel لم تُحمَّل بعد، تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة', 'error'); return; }
  const sample = { 'اسم المشترك':'محمد أحمد علي', 'رقم العداد':'1_50', 'نوع الاشتراك':'منزلي', 'المنطقة':'حي النور', 'المربع':'مربع 1', 'آخر قراءة':0, 'رصيد سابق':0, 'الهاتف':'777000000' };
  const ws = XLSX.utils.json_to_sheet([sample], { header: XLSX_HEADERS });
  ws['!cols'] = XLSX_HEADERS.map(()=>({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المشتركون');
  XLSX.writeFile(wb, 'قالب_استيراد_المشتركين.xlsx');
}
function downloadSubscribersXlsx(){
  if(!isXlsxReady()){ toast('مكتبة Excel لم تُحمَّل بعد، تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة', 'error'); return; }
  const rows = DB.subscribers.map(s=>{
    const type = DB.subscription_types.find(t=>t.id===s.subscription_type_id);
    const area = DB.areas.find(a=>a.id===s.area_id);
    const square = DB.squares.find(sq=>sq.id===s.square_id);
    return {
      'رقم المشترك': s.subscriber_number, 'اسم المشترك': s.subscriber_name, 'رقم العداد': s.meter_number||'',
      'نوع الاشتراك': type?type.type_name:'', 'المنطقة': area?area.area_name:'', 'المربع': square?square.square_name:'',
      'آخر قراءة': s.last_reading_value, 'رصيد سابق': s.last_balance, 'الهاتف': s.phone||'', 'الحالة': s.status
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = ['رقم المشترك','اسم المشترك','رقم العداد','نوع الاشتراك','المنطقة','المربع','آخر قراءة','رصيد سابق','الهاتف','الحالة'].map(()=>({wch:16}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المشتركون');
  XLSX.writeFile(wb, 'المشتركون_' + todayISO() + '.xlsx');
}
function handleXlsxImport(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!isXlsxReady()){ toast('مكتبة Excel لم تُحمَّل بعد، تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة', 'error'); e.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = (ev)=>{
    try{
      const wb = XLSX.read(ev.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      if(!rows.length){ toast('الملف فارغ أو بدون بيانات', 'error'); e.target.value=''; return; }
      let added = 0, skipped = 0;
      rows.forEach(row=>{
        const name = String(row['اسم المشترك']||'').trim();
        const meter = String(row['رقم العداد']||'').trim();
        const typeName = String(row['نوع الاشتراك']||'').trim();
        const areaName = String(row['المنطقة']||'').trim();
        const squareName = String(row['المربع']||'').trim();
        const lastReading = row['آخر قراءة'];
        const lastBalance = row['رصيد سابق'];
        const phone = String(row['الهاتف']||'').trim();
        if(!name){ skipped++; return; }
        const type = DB.subscription_types.find(t=>t.type_name.trim()===typeName);
        if(!type){ skipped++; return; }
        let area = null, square = null;
        if(areaName){
          area = DB.areas.find(a=>a.area_name.trim()===areaName);
          if(!area){ area = { id:nextId('areas'), area_name:areaName }; DB.areas.push(area); }
          if(squareName){
            square = DB.squares.find(sq=>sq.area_id===area.id && sq.square_name.trim()===squareName);
            if(!square){ square = { id:nextId('squares'), square_name:squareName, area_id:area.id }; DB.squares.push(square); }
          }
        }
        const id = nextId('subscribers');
        DB.subscribers.push({
          id, subscriber_number:'SUB-'+String(1000+id), subscriber_name:name,
          meter_number: meter, subscription_type_id:type.id,
          area_id: area?area.id:null, square_id: square?square.id:null,
          status:'active', last_reading_value:Number(lastReading)||0, last_balance:Number(lastBalance)||0,
          phone, address:'', join_date:todayISO(), notes:''
        });
        added++;
      });
      persist();
      toast(`تم استيراد ${added} مشترك${skipped?`، وتخطي ${skipped} (تحقق من اسم نوع الاشتراك)`:''}`, added?'success':'error');
      renderSubTable();
    }catch(err){
      console.warn(err);
      toast('تعذّرت قراءة الملف — تأكد أنه بصيغة Excel (xlsx) صحيحة', 'error');
    }
    e.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

/* ---------- 8) أنواع الاشتراك ---------- */
function renderTypes(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>أنواع الاشتراك</h2><p>تُستخدم هذه الفئات لتحديد سعر الوحدة والرسوم الشهرية عند إصدار الفاتورة</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="addTypeBtn">${icon('plus')} إضافة نوع</button></div>
    </div>
    <div class="card"><div class="table-scroll" id="typesTableWrap"></div></div>
  `;
  document.getElementById('addTypeBtn').addEventListener('click', ()=>openTypeForm());
  renderTypesTable();
}
function renderTypesTable(){
  const wrap = document.getElementById('typesTableWrap');
  if(!DB.subscription_types.length){
    wrap.innerHTML = `<div class="empty">${icon('types')}<b>لا توجد أنواع اشتراك</b><span>أضف نوعاً مثل «منزلي» أو «تجاري» لتتمكن من إضافة مشتركين</span></div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>اسم النوع</th><th>الرسوم الشهرية</th><th>سعر الوحدة</th><th>عدد المشتركين</th><th></th></tr></thead>
      <tbody>
        ${DB.subscription_types.map(t=>{
          const count = DB.subscribers.filter(s=>s.subscription_type_id===t.id).length;
          return `<tr>
            <td>${esc(t.type_name)}</td>
            <td class="num">${fmtMoney(t.monthly_fee)}</td>
            <td class="num">${fmtMoney(t.unit_price)}</td>
            <td class="num muted">${count}</td>
            <td>
              <button class="btn btn-sm btn-ghost" onclick="openTypeForm(${t.id})">${icon('edit')}</button>
              <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteType(${t.id})">${icon('trash')}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}
function openTypeForm(id){
  const editing = DB.subscription_types.find(t=>t.id===id);
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل نوع اشتراك':'إضافة نوع اشتراك'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field"><label>اسم النوع</label><input type="text" id="t_name" value="${editing?esc(editing.type_name):''}" placeholder="مثال: منزلي، تجاري، حكومي"></div>
      <div class="field-row">
        <div class="field"><label>الرسوم الشهرية الثابتة</label><input type="number" id="t_fee" value="${editing?editing.monthly_fee:0}" min="0"></div>
        <div class="field"><label>سعر الوحدة (لكل متر مكعب)</label><input type="number" id="t_price" value="${editing?editing.unit_price:0}" min="0"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="saveTypeBtn">${icon('check')} حفظ</button>
    </div>
  `);
  document.getElementById('saveTypeBtn').addEventListener('click', ()=>{
    const name = document.getElementById('t_name').value.trim();
    if(!name){ toast('يرجى إدخال اسم النوع', 'error'); return; }
    const payload = { type_name:name, monthly_fee:Number(document.getElementById('t_fee').value)||0, unit_price:Number(document.getElementById('t_price').value)||0, is_active:true };
    if(editing){ Object.assign(editing, payload); toast('تم تحديث النوع', 'success'); }
    else{ DB.subscription_types.push(Object.assign({id:nextId('types')}, payload)); toast('تمت الإضافة بنجاح', 'success'); }
    persist(); closeModal(); renderTypesTable();
  });
}
function deleteType(id){
  const inUse = DB.subscribers.some(s=>s.subscription_type_id===id);
  if(inUse){ toast('لا يمكن حذف نوع مرتبط بمشتركين حالياً', 'error'); return; }
  confirmDialog('سيتم حذف نوع الاشتراك هذا نهائياً. هل أنت متأكد؟', ()=>{
    DB.subscription_types = DB.subscription_types.filter(t=>t.id!==id);
    persist(); toast('تم الحذف', 'success'); renderTypesTable();
  });
}

/* ---------- 8ب) المناطق والمربعات ---------- */
function renderAreas(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>المناطق والمربعات</h2><p>تُستخدم لتقسيم المشتركين جغرافياً وتسهيل جولات القراءة والتحصيل</p></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>المناطق</h3><button class="btn btn-sm btn-primary" id="addAreaBtn">${icon('plus')} إضافة منطقة</button></div>
        <div class="table-scroll" id="areasTableWrap"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>المربعات</h3><button class="btn btn-sm btn-primary" id="addSquareBtn">${icon('plus')} إضافة مربع</button></div>
        <div class="table-scroll" id="squaresTableWrap"></div>
      </div>
    </div>
  `;
  document.getElementById('addAreaBtn').addEventListener('click', ()=>openAreaForm());
  document.getElementById('addSquareBtn').addEventListener('click', ()=>openSquareForm());
  renderAreasTable(); renderSquaresTable();
}
function renderAreasTable(){
  const wrap = document.getElementById('areasTableWrap');
  if(!DB.areas.length){ wrap.innerHTML = `<div class="empty">${icon('map')}<b>لا توجد مناطق</b><span>أضف أول منطقة لتنظيم المشتركين</span></div>`; return; }
  wrap.innerHTML = `
    <table><thead><tr><th>اسم المنطقة</th><th>عدد المربعات</th><th>عدد المشتركين</th><th></th></tr></thead>
    <tbody>
      ${DB.areas.map(a=>{
        const sqCount = DB.squares.filter(s=>s.area_id===a.id).length;
        const subCount = DB.subscribers.filter(s=>s.area_id===a.id).length;
        return `<tr>
          <td>${esc(a.area_name)}</td><td class="num muted">${sqCount}</td><td class="num muted">${subCount}</td>
          <td><button class="btn btn-sm btn-ghost" onclick="openAreaForm(${a.id})">${icon('edit')}</button>
              <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteArea(${a.id})">${icon('trash')}</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}
function renderSquaresTable(){
  const wrap = document.getElementById('squaresTableWrap');
  if(!DB.squares.length){ wrap.innerHTML = `<div class="empty">${icon('map')}<b>لا توجد مربعات</b><span>أضف منطقة أولاً ثم مربعاتها</span></div>`; return; }
  wrap.innerHTML = `
    <table><thead><tr><th>اسم المربع</th><th>المنطقة</th><th>عدد المشتركين</th><th></th></tr></thead>
    <tbody>
      ${DB.squares.map(sq=>{
        const area = DB.areas.find(a=>a.id===sq.area_id);
        const subCount = DB.subscribers.filter(s=>s.square_id===sq.id).length;
        return `<tr>
          <td>${esc(sq.square_name)}</td><td class="muted">${area?esc(area.area_name):'—'}</td><td class="num muted">${subCount}</td>
          <td><button class="btn btn-sm btn-ghost" onclick="openSquareForm(${sq.id})">${icon('edit')}</button>
              <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteSquare(${sq.id})">${icon('trash')}</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}
function openAreaForm(id){
  const editing = DB.areas.find(a=>a.id===id);
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل منطقة':'إضافة منطقة'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body"><div class="field"><label>اسم المنطقة</label><input type="text" id="a_name" value="${editing?esc(editing.area_name):''}" placeholder="مثال: حي النور"></div></div>
    <div class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn btn-primary" id="saveAreaBtn">${icon('check')} حفظ</button></div>
  `);
  document.getElementById('saveAreaBtn').addEventListener('click', ()=>{
    const name = document.getElementById('a_name').value.trim();
    if(!name){ toast('أدخل اسم المنطقة', 'error'); return; }
    if(editing) editing.area_name = name;
    else DB.areas.push({ id:nextId('areas'), area_name:name });
    persist(); closeModal(); toast('تم الحفظ', 'success'); renderAreasTable();
  });
}
function deleteArea(id){
  if(DB.squares.some(s=>s.area_id===id) || DB.subscribers.some(s=>s.area_id===id)){ toast('لا يمكن حذف منطقة مرتبطة بمربعات أو مشتركين', 'error'); return; }
  confirmDialog('سيتم حذف هذه المنطقة نهائياً. هل أنت متأكد؟', ()=>{ DB.areas = DB.areas.filter(a=>a.id!==id); persist(); toast('تم الحذف', 'success'); renderAreasTable(); });
}
function openSquareForm(id){
  if(!DB.areas.length){ toast('أضف منطقة واحدة على الأقل أولاً', 'error'); return; }
  const editing = DB.squares.find(s=>s.id===id);
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل مربع':'إضافة مربع'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field"><label>المنطقة</label><select id="sq_area">${DB.areas.map(a=>`<option value="${a.id}" ${editing&&editing.area_id===a.id?'selected':''}>${esc(a.area_name)}</option>`).join('')}</select></div>
      <div class="field"><label>اسم المربع</label><input type="text" id="sq_name" value="${editing?esc(editing.square_name):''}" placeholder="مثال: مربع 1"></div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn btn-primary" id="saveSquareBtn">${icon('check')} حفظ</button></div>
  `);
  document.getElementById('saveSquareBtn').addEventListener('click', ()=>{
    const name = document.getElementById('sq_name').value.trim();
    if(!name){ toast('أدخل اسم المربع', 'error'); return; }
    const areaId = Number(document.getElementById('sq_area').value);
    if(editing){ editing.square_name = name; editing.area_id = areaId; }
    else DB.squares.push({ id:nextId('squares'), square_name:name, area_id:areaId });
    persist(); closeModal(); toast('تم الحفظ', 'success'); renderSquaresTable();
  });
}
function deleteSquare(id){
  if(DB.subscribers.some(s=>s.square_id===id)){ toast('لا يمكن حذف مربع مرتبط بمشتركين', 'error'); return; }
  confirmDialog('سيتم حذف هذا المربع نهائياً. هل أنت متأكد؟', ()=>{ DB.squares = DB.squares.filter(s=>s.id!==id); persist(); toast('تم الحذف', 'success'); renderSquaresTable(); });
}

/* ---------- 9) الدورات ---------- */
function renderCycles(root){
  const openCycle = DB.cycles.find(c=>c.status==='open');
  root.innerHTML = `
    <div class="view-head">
      <div><h2>الدورات</h2><p>دورة واحدة مفتوحة فقط في كل مرة — أغلقها لترحيل الأرصدة وفتح دورة جديدة</p></div>
      <div class="view-actions">
        ${!openCycle ? `<button class="btn btn-primary" id="addCycleBtn">${icon('plus')} فتح دورة جديدة</button>` : ''}
      </div>
    </div>
    <div class="card"><div class="table-scroll" id="cyclesTableWrap"></div></div>
  `;
  if(!openCycle) document.getElementById('addCycleBtn').addEventListener('click', ()=>openCycleForm());
  renderCyclesTable();
}
function renderCyclesTable(){
  const wrap = document.getElementById('cyclesTableWrap');
  if(!DB.cycles.length){
    wrap.innerHTML = `<div class="empty">${icon('cycles')}<b>لا توجد دورات بعد</b><span>افتح أول دورة قراءة لتبدأ بتسجيل الفواتير</span></div>`;
    return;
  }
  const sorted = [...DB.cycles].sort((a,b)=>b.id-a.id);
  wrap.innerHTML = `
    <table>
      <thead><tr><th>اسم الدورة</th><th>الفترة</th><th>القارئ</th><th>عدد الفواتير</th><th>الحالة</th><th></th></tr></thead>
      <tbody>
        ${sorted.map(c=>{
          const count = DB.readings.filter(r=>r.cycle_id===c.id).length;
          return `<tr>
            <td>${esc(c.cycle_name)}</td>
            <td class="muted">${fmtDate(c.start_date)} — ${fmtDate(c.end_date)}</td>
            <td>${esc(c.reader_name||'—')}</td>
            <td class="num">${count}</td>
            <td>${c.status==='open' ? '<span class="badge badge-success">'+icon('unlock')+' مفتوحة</span>' : '<span class="badge badge-muted">'+icon('lock')+' مغلقة</span>'}</td>
            <td>${c.status==='open' ? `<button class="btn btn-sm btn-dark" onclick="closeCycleFlow(${c.id})">إغلاق الدورة</button>` : `<button class="btn btn-sm btn-ghost" onclick="navigate('reports')">عرض التقرير</button>`}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}
function openCycleForm(){
  const lastCycle = [...DB.cycles].sort((a,b)=>b.id-a.id)[0];
  const suggestedStart = lastCycle ? new Date(new Date(lastCycle.end_date).getTime()+86400000).toISOString().slice(0,10) : todayISO();
  openModal(`
    <div class="modal-head"><h3>فتح دورة قراءة جديدة</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field"><label>اسم الدورة</label><input type="text" id="c_name" placeholder="مثال: دورة شهر يونيو 2026"></div>
      <div class="field-row">
        <div class="field"><label>تاريخ البداية</label><input type="date" id="c_start" value="${suggestedStart}"></div>
        <div class="field"><label>تاريخ النهاية</label><input type="date" id="c_end"></div>
      </div>
      <div class="field"><label>اسم القارئ (اختياري)</label><input type="text" id="c_reader" placeholder="اسم من سيقرأ العدادات"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="saveCycleBtn">${icon('check')} فتح الدورة</button>
    </div>
  `);
  document.getElementById('saveCycleBtn').addEventListener('click', ()=>{
    const name = document.getElementById('c_name').value.trim();
    const start = document.getElementById('c_start').value;
    const end = document.getElementById('c_end').value;
    if(!name || !start || !end){ toast('يرجى تعبئة جميع الحقول', 'error'); return; }
    if(end < start){ toast('تاريخ النهاية يجب أن يكون بعد تاريخ البداية', 'error'); return; }
    DB.cycles.push({ id:nextId('cycles'), cycle_name:name, start_date:start, end_date:end, reader_name:document.getElementById('c_reader').value.trim(), status:'open' });
    persist(); closeModal(); toast('تم فتح الدورة الجديدة', 'success'); renderCycles(document.getElementById('viewRoot'));
  });
}
function closeCycleFlow(cycleId){
  const cycle = DB.cycles.find(c=>c.id===cycleId);
  const activeSubs = DB.subscribers.filter(s=>s.status==='active');
  const doneIds = new Set(DB.readings.filter(r=>r.cycle_id===cycleId).map(r=>r.subscriber_id));
  const missingSubs = activeSubs.filter(s=>!doneIds.has(s.id));
  const missing = missingSubs.length;
  const existingRemain = DB.readings.filter(r=>r.cycle_id===cycleId).reduce((s,r)=>s+r.remaining_amount,0);
  const missingFeesSum = missingSubs.reduce((s,sub)=>{
    const type = DB.subscription_types.find(t=>t.id===sub.subscription_type_id);
    return s + (type?type.monthly_fee:0) + (Number(sub.last_balance)||0);
  }, 0);
  const remainSum = existingRemain + missingFeesSum;
  confirmDialog(
    (missing>0 ? `تنبيه: يوجد ${missing} مشترك لم تُسجَّل قراءتهم لهذه الدورة. سيتم إصدار فاتورة تلقائية لكل منهم بنفس القراءة السابقة (استهلاك صفر) + الرسوم الشهرية + أي متأخرات سابقة. ` : '') +
    `سيتم إغلاق «${cycle.cycle_name}» نهائياً، وترحيل آخر قراءة وأي مبلغ متبقٍ (${fmtMoney(remainSum)}) كمتأخرات للدورة القادمة. هل تريد المتابعة؟`,
    ()=>{
      // إصدار فاتورة تلقائية (استهلاك صفر) لكل مشترك نشط لم تُسجَّل قراءته
      missingSubs.forEach(sub=>{
        const type = DB.subscription_types.find(t=>t.id===sub.subscription_type_id);
        const r = buildReading(sub, cycle, type, sub.last_reading_value, sub.last_reading_value, 0, sub.last_balance || 0);
        r.notes = 'فاتورة تلقائية — لم تُسجَّل قراءة لهذه الدورة (استهلاك صفر + الرسوم الشهرية فقط)';
        recalcReading(r);
        DB.readings.push(r);
      });
      // ترحيل آخر قراءة وأي رصيد متبقٍ لكل فواتير هذه الدورة (المسجّلة يدوياً + التلقائية)
      DB.readings.filter(r=>r.cycle_id===cycleId).forEach(r=>{
        const sub = DB.subscribers.find(s=>s.id===r.subscriber_id);
        if(sub){ sub.last_reading_value = r.current_reading; sub.last_balance = r.remaining_amount; }
        r.invoice_status = 1;
      });
      cycle.status = 'closed';
      persist();
      toast(missing>0 ? `تم إغلاق الدورة، وإصدار ${missing} فاتورة تلقائية، وترحيل الأرصدة` : 'تم إغلاق الدورة وترحيل الأرصدة', 'success');
      renderCycles(document.getElementById('viewRoot'));
    }
  );
}

/* ---------- 10) إدخال القراءات ---------- */
function renderReadings(root){
  const openCycle = DB.cycles.find(c=>c.status==='open');
  if(!openCycle){
    root.innerHTML = `<div class="card"><div class="empty">${icon('cycles')}<b>لا توجد دورة قراءة مفتوحة</b><span>افتح دورة جديدة أولاً من شاشة «الدورات»</span></div></div>`;
    return;
  }
  const doneIds = new Set(DB.readings.filter(r=>r.cycle_id===openCycle.id).map(r=>r.subscriber_id));
  const pending = DB.subscribers.filter(s=>s.status==='active' && !doneIds.has(s.id));
  const done = DB.subscribers.filter(s=>doneIds.has(s.id));

  root.innerHTML = `
    <div class="view-head">
      <div><h2>إدخال القراءات — ${esc(openCycle.cycle_name)}</h2><p>${done.length} تم تسجيلهم، ${pending.length} بانتظار القراءة</p></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>بانتظار القراءة</h3><span class="hint">${pending.length}</span></div>
        <div class="table-scroll" style="max-height:520px;">
          ${!pending.length ? `<div class="empty">${icon('check')}<b>تم إدخال جميع القراءات</b><span>يمكنك الآن مراجعة الفواتير أو إغلاق الدورة</span></div>` : `
          <table>
            <thead><tr><th>المشترك</th><th>العداد</th><th>آخر قراءة</th><th></th></tr></thead>
            <tbody>
              ${pending.map(s=>`<tr>
                <td>${esc(s.subscriber_name)}</td>
                <td class="num muted">${esc(s.meter_number||'—')}</td>
                <td class="num">${s.last_reading_value}</td>
                <td><button class="btn btn-sm btn-primary" onclick="openReadingForm(${s.id}, ${openCycle.id})">إدخال القراءة</button></td>
              </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>تم تسجيلهم في هذه الدورة</h3><span class="hint">${done.length}</span></div>
        <div class="table-scroll" style="max-height:520px;">
          ${!done.length ? `<div class="empty">${icon('readings')}<b>لم تُسجَّل أي قراءة بعد</b><span>ابدأ من القائمة المجاورة</span></div>` : `
          <table>
            <thead><tr><th>المشترك</th><th>الاستهلاك</th><th>المستحق</th><th></th></tr></thead>
            <tbody>
              ${done.map(s=>{
                const r = DB.readings.find(r=>r.subscriber_id===s.id && r.cycle_id===openCycle.id);
                return `<tr>
                  <td>${esc(s.subscriber_name)}</td>
                  <td class="num">${r.total_consumed_units}</td>
                  <td class="num">${fmtMoney(r.amount_due)}</td>
                  <td><button class="btn btn-sm btn-ghost" onclick="openReadingForm(${s.id}, ${openCycle.id})">${icon('edit')}</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
    </div>
  `;
}

function openReadingForm(subscriberId, cycleId){
  const sub = DB.subscribers.find(s=>s.id===subscriberId);
  const cycle = DB.cycles.find(c=>c.id===cycleId);
  const type = DB.subscription_types.find(t=>t.id===sub.subscription_type_id);
  const existing = DB.readings.find(r=>r.subscriber_id===subscriberId && r.cycle_id===cycleId);
  const prevReading = existing ? existing.previous_reading : sub.last_reading_value;
  const arrears = existing ? existing.arrears : (sub.last_balance || 0);

  openModal(`
    <div class="modal-head"><h3>قراءة عداد — ${esc(sub.subscriber_name)}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field-row-3" style="margin-bottom:14px;">
        <div><div class="hint-text">رقم العداد</div><div class="readonly-box">${esc(sub.meter_number||'—')}</div></div>
        <div><div class="hint-text">نوع الاشتراك</div><div class="readonly-box">${type?esc(type.type_name):'—'}</div></div>
        <div><div class="hint-text">القراءة السابقة</div><div class="readonly-box" id="prevReadingBox">${prevReading}</div></div>
      </div>
      <div class="field-row">
        <div class="field"><label>القراءة الحالية</label><input type="number" id="r_current" value="${existing?existing.current_reading:''}" min="0" placeholder="اقرأ من العداد"></div>
        <div class="field"><label>وحدات تقديرية (عند عطل العداد)</label><input type="number" id="r_estimated" value="${existing?existing.estimated_units:0}" min="0"></div>
      </div>
      <div class="card" style="background:var(--paper-2); border:none; padding:14px; margin-top:6px;" id="calcPreview"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="saveReadingBtn">${icon('check')} حفظ القراءة وإصدار الفاتورة</button>
    </div>
  `);

  function updatePreview(){
    const curr = Number(document.getElementById('r_current').value)||0;
    const est = Number(document.getElementById('r_estimated').value)||0;
    const diff = Math.max(0, curr - prevReading);
    const total = diff + est;
    const consumption = total * (type?type.unit_price:0);
    const fee = type?type.monthly_fee:0;
    const due = consumption + fee + arrears;
    document.getElementById('calcPreview').innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;"><span class="muted">فرق القراءة</span><span class="num">${diff} م³</span></div>
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;"><span class="muted">إجمالي الوحدات المستهلكة</span><span class="num">${total} م³</span></div>
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;"><span class="muted">قيمة الاستهلاك (${type?fmtMoney(type.unit_price):0} × ${total})</span><span class="num">${fmtMoney(consumption)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px;"><span class="muted">الرسوم الشهرية</span><span class="num">${fmtMoney(fee)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:8px;"><span class="muted">متأخرات سابقة</span><span class="num" style="${arrears>0?'color:var(--danger)':''}">${fmtMoney(arrears)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; border-top:1px solid var(--line); padding-top:8px;"><span>إجمالي المستحق</span><span class="num" style="color:var(--aqua)">${fmtMoney(due)}</span></div>
    `;
  }
  document.getElementById('r_current').addEventListener('input', updatePreview);
  document.getElementById('r_estimated').addEventListener('input', updatePreview);
  updatePreview();
  document.getElementById('r_current').focus();

  document.getElementById('saveReadingBtn').addEventListener('click', ()=>{
    const curr = document.getElementById('r_current').value;
    if(curr === ''){ toast('يرجى إدخال القراءة الحالية', 'error'); return; }
    const currNum = Number(curr);
    if(currNum < prevReading && Number(document.getElementById('r_estimated').value)===0){
      toast('القراءة الحالية أقل من السابقة! تحقق من الرقم أو أدخل وحدات تقديرية', 'error'); return;
    }
    if(existing){
      existing.current_reading = currNum;
      existing.estimated_units = Number(document.getElementById('r_estimated').value)||0;
      existing.unit_price = type?type.unit_price:0;
      existing.monthly_fee = type?type.monthly_fee:0;
      recalcReading(existing);
      toast('تم تحديث القراءة', 'success');
    }else{
      const r = buildReading(sub, cycle, type, prevReading, currNum, Number(document.getElementById('r_estimated').value)||0, arrears);
      recalcReading(r);
      DB.readings.push(r);
      toast('تم حفظ القراءة وإصدار الفاتورة', 'success');
    }
    persist(); closeModal(); renderReadings(document.getElementById('viewRoot'));
  });
}

/* ---------- 11) الفواتير والدفعات ---------- */
let invFilterCycle = 'all';
let invFilterStatus = 'all';
let invSearch = '';

function renderInvoices(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>الفواتير والدفعات</h2><p>${DB.readings.length} فاتورة على مستوى جميع الدورات</p></div>
    </div>
    <div class="toolbar">
      <div class="search-box">${icon('search')}<input type="search" id="invSearch" placeholder="ابحث باسم المشترك أو رقم الفاتورة..." value="${esc(invSearch)}"></div>
      <select id="invCycleFilter" style="max-width:220px;">
        <option value="all">كل الدورات</option>
        ${[...DB.cycles].sort((a,b)=>b.id-a.id).map(c=>`<option value="${c.id}" ${invFilterCycle==String(c.id)?'selected':''}>${esc(c.cycle_name)}</option>`).join('')}
      </select>
      <select id="invStatusFilter" style="max-width:180px;">
        <option value="all">كل الحالات</option>
        <option value="unpaid" ${invFilterStatus==='unpaid'?'selected':''}>غير مسددة</option>
        <option value="partial" ${invFilterStatus==='partial'?'selected':''}>مسددة جزئياً</option>
        <option value="paid" ${invFilterStatus==='paid'?'selected':''}>مسددة بالكامل</option>
      </select>
    </div>
    <div class="card"><div class="table-scroll" id="invTableWrap"></div></div>
  `;
  document.getElementById('invSearch').addEventListener('input', e=>{ invSearch=e.target.value; renderInvTable(); });
  document.getElementById('invCycleFilter').addEventListener('change', e=>{ invFilterCycle=e.target.value; renderInvTable(); });
  document.getElementById('invStatusFilter').addEventListener('change', e=>{ invFilterStatus=e.target.value; renderInvTable(); });
  renderInvTable();
}

function invoiceRows(){
  let list = DB.readings.map(r=>({ r, sub: DB.subscribers.find(s=>s.id===r.subscriber_id), cycle: DB.cycles.find(c=>c.id===r.cycle_id) }));
  if(invFilterCycle!=='all') list = list.filter(x=>String(x.r.cycle_id)===invFilterCycle);
  if(invFilterStatus!=='all') list = list.filter(x=>x.r.status===invFilterStatus);
  const term = invSearch.trim().toLowerCase();
  if(term) list = list.filter(x=> (x.sub&&x.sub.subscriber_name.toLowerCase().includes(term)) || x.r.invoice_number.toLowerCase().includes(term));
  return list.sort((a,b)=>b.r.id-a.r.id);
}

function renderInvTable(){
  const wrap = document.getElementById('invTableWrap');
  const rows = invoiceRows();
  if(!rows.length){
    wrap.innerHTML = `<div class="empty">${icon('invoices')}<b>لا توجد فواتير مطابقة</b><span>جرّب تغيير الفلاتر أو ابدأ بإدخال قراءات جديدة</span></div>`;
    return;
  }
  const statusMap = { unpaid:['غير مسددة','badge-danger'], partial:['جزئية','badge-amber'], paid:['مسددة','badge-success'] };
  wrap.innerHTML = `
    <table>
      <thead><tr><th>رقم الفاتورة</th><th>المشترك</th><th>الدورة</th><th>الاستهلاك</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
      <tbody>
        ${rows.map(({r,sub,cycle})=>{
          const st = statusMap[r.status] || statusMap.unpaid;
          return `<tr>
            <td class="num muted">${esc(r.invoice_number)} ${r.notes && r.notes.includes('فاتورة تلقائية') ? `<span class="badge badge-amber" title="${esc(r.notes)}">تلقائية</span>` : ''}</td>
            <td>${sub?esc(sub.subscriber_name):'<span class="muted">محذوف</span>'}</td>
            <td class="muted">${cycle?esc(cycle.cycle_name):'—'}</td>
            <td class="num">${r.total_consumed_units} م³</td>
            <td class="num">${fmtMoney(r.amount_due)}</td>
            <td class="num" style="color:var(--success)">${fmtMoney(r.amount_paid)}</td>
            <td class="num" style="${r.remaining_amount>0?'color:var(--danger)':''}">${fmtMoney(r.remaining_amount)}</td>
            <td><span class="badge ${st[1]}">${st[0]}</span></td>
            <td style="display:flex; gap:4px;">
              ${r.remaining_amount>0 ? `<button class="btn btn-sm btn-primary" onclick="openPaymentForm(${r.id})">${icon('cash')}</button>` : ''}
              <button class="btn btn-sm btn-ghost" onclick="openInvoicePrint(${r.id})">${icon('print')}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function openPaymentForm(readingId){
  const r = DB.readings.find(x=>x.id===readingId);
  const sub = DB.subscribers.find(s=>s.id===r.subscriber_id);
  const activeCollectors = DB.collectors.filter(c=>c.is_active!==false);
  openModal(`
    <div class="modal-head"><h3>تسجيل دفعة — ${esc(sub.subscriber_name)}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field-row" style="margin-bottom:16px;">
        <div><div class="hint-text">المبلغ المستحق</div><div class="readonly-box">${fmtMoney(r.amount_due)}</div></div>
        <div><div class="hint-text">المتبقي حالياً</div><div class="readonly-box" style="color:var(--danger)">${fmtMoney(r.remaining_amount)}</div></div>
      </div>
      <div class="field"><label>المبلغ المدفوع الآن</label><input type="number" id="p_amount" value="${r.remaining_amount}" min="0" max="${r.remaining_amount}"></div>
      ${activeCollectors.length ? `
      <div class="field"><label>المتحصل (اختياري)</label>
        <select id="p_collector">
          <option value="">بدون تحديد / دفع مباشر</option>
          ${activeCollectors.map(c=>`<option value="${c.id}" ${CURRENT_USER&&CURRENT_USER.role==='collector'&&CURRENT_USER.full_name===c.collector_name?'selected':''}>${esc(c.collector_name)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="field"><label>ملاحظات (اختياري)</label><input type="text" id="p_notes" placeholder="مثال: دفعة نقدية"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="savePayBtn">${icon('check')} تأكيد الدفعة</button>
    </div>
  `);
  document.getElementById('savePayBtn').addEventListener('click', ()=>{
    const amt = Number(document.getElementById('p_amount').value);
    if(!amt || amt<=0){ toast('أدخل مبلغاً صحيحاً', 'error'); return; }
    const collectorId = activeCollectors.length && document.getElementById('p_collector').value ? Number(document.getElementById('p_collector').value) : null;
    const notes = document.getElementById('p_notes').value.trim();
    recordPayment(r, amt, collectorId, notes);
    persist(); closeModal(); toast('تم تسجيل الدفعة', 'success'); renderInvTable();
  });
}

function openInvoicePrint(readingId){
  const r = DB.readings.find(x=>x.id===readingId);
  const sub = DB.subscribers.find(s=>s.id===r.subscriber_id);
  const cycle = DB.cycles.find(c=>c.id===r.cycle_id);
  const type = DB.subscription_types.find(t=>t.id===(sub&&sub.subscription_type_id));
  const org = DB.settings;
  const qrPayload = `INV:${r.invoice_number}|SUB:${sub?sub.subscriber_number:''}|DUE:${Math.round(r.amount_due)}|PAID:${Math.round(r.amount_paid)}`;
  const qrSvg = generateQRSvg(qrPayload, 3);
  const html = `
    <div class="invoice-sheet" style="max-width:640px; margin:0 auto;">
      <div class="invoice-top">
        <div class="invoice-org"><b>${esc(org.org_name)}</b><div>${esc(org.org_sub||'')}</div></div>
        <div class="invoice-meta">
          <div><b>رقم الفاتورة:</b> ${esc(r.invoice_number)}</div>
          <div><b>الدورة:</b> ${cycle?esc(cycle.cycle_name):'—'}</div>
          <div><b>التاريخ:</b> ${fmtDate(r.created_at)}</div>
        </div>
      </div>
      <div class="invoice-grid">
        <div class="invoice-box"><b>بيانات المشترك</b>
          ${esc(sub?sub.subscriber_name:'—')}<br>
          رقم المشترك: ${esc(sub?sub.subscriber_number:'—')}<br>
          رقم العداد: ${esc(sub?sub.meter_number||'—':'—')}
        </div>
        <div class="invoice-box"><b>تفاصيل القراءة</b>
          القراءة السابقة: ${r.previous_reading}<br>
          القراءة الحالية: ${r.current_reading}<br>
          الاستهلاك: ${r.total_consumed_units} م³ (${type?esc(type.type_name):'—'})
        </div>
      </div>
      <div class="invoice-total-row"><span>قيمة الاستهلاك</span><span class="num">${fmtMoney(r.consumption_amount)}</span></div>
      <div class="invoice-total-row"><span>الرسوم الشهرية</span><span class="num">${fmtMoney(r.monthly_fee)}</span></div>
      <div class="invoice-total-row"><span>متأخرات سابقة</span><span class="num">${fmtMoney(r.arrears)}</span></div>
      ${r.settlement_amount>0?`<div class="invoice-total-row"><span>تسوية</span><span class="num">-${fmtMoney(r.settlement_amount)}</span></div>`:''}
      <div class="invoice-total-row grand"><span>الإجمالي المستحق</span><span class="num">${fmtMoney(r.amount_due)}</span></div>
      <div class="invoice-total-row"><span>المدفوع</span><span class="num" style="color:var(--success)">${fmtMoney(r.amount_paid)}</span></div>
      <div class="invoice-total-row"><span>المتبقي</span><span class="num" style="color:var(--danger)">${fmtMoney(r.remaining_amount)}</span></div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; gap:12px;">
        <p style="font-size:11px; color:var(--ink-faint); margin:0;">امسح الرمز للتحقق السريع من رقم الفاتورة والمبالغ<br>شكراً لالتزامكم بالسداد في موعده — نظام نبع لإدارة الفوترة</p>
        <div style="flex-shrink:0;">${qrSvg}</div>
      </div>
    </div>
  `;
  openModal(`
    <div class="modal-head no-print"><h3>معاينة الفاتورة</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">${html}</div>
    <div class="modal-foot no-print">
      <button class="btn" data-close>إغلاق</button>
      <button class="btn btn-primary" id="doPrintBtn">${icon('print')} طباعة</button>
    </div>
  `, {wide:true});
  document.getElementById('doPrintBtn').addEventListener('click', ()=>{
    document.getElementById('print-area').innerHTML = html;
    document.getElementById('print-area').style.display = 'block';
    window.print();
    setTimeout(()=>{ document.getElementById('print-area').style.display = 'none'; }, 300);
  });
}

/* ---------- 12) التقارير ---------- */
let reportTab = 'arrears';
let reportCollectorId = 'all';
function renderReports(root){
  root.innerHTML = `
    <div class="view-head"><div><h2>التقارير</h2><p>تقارير أساسية جاهزة للطباعة أو المراجعة السريعة</p></div></div>
    <div class="toolbar">
      <button class="btn ${reportTab==='arrears'?'btn-primary':''}" onclick="switchReport('arrears')">${icon('reports')} المتأخرات</button>
      <button class="btn ${reportTab==='unpaid'?'btn-primary':''}" onclick="switchReport('unpaid')">${icon('invoices')} فواتير غير مسددة</button>
      <button class="btn ${reportTab==='consumption'?'btn-primary':''}" onclick="switchReport('consumption')">${icon('readings')} الاستهلاك حسب الدورة</button>
      <button class="btn ${reportTab==='collector'?'btn-primary':''}" onclick="switchReport('collector')">${icon('userCheck')} كشف متحصل</button>
    </div>
    <div class="card"><div class="table-scroll" id="reportWrap"></div></div>
  `;
  renderReportBody();
}
function switchReport(tab){ reportTab = tab; renderReports(document.getElementById('viewRoot')); }
function renderReportBody(){
  const wrap = document.getElementById('reportWrap');
  if(reportTab==='arrears'){
    const list = [...DB.subscribers].filter(s=>Number(s.last_balance)>0).sort((a,b)=>b.last_balance-a.last_balance);
    if(!list.length){ wrap.innerHTML = emptyReport('لا توجد متأخرات حالياً', 'جميع المشتركين رصيدهم صفر'); return; }
    const total = list.reduce((s,x)=>s+Number(x.last_balance),0);
    wrap.innerHTML = `
      <table>
        <thead><tr><th>رقم المشترك</th><th>الاسم</th><th>رقم العداد</th><th>الرصيد المتأخر</th></tr></thead>
        <tbody>
          ${list.map(s=>`<tr><td class="num">${esc(s.subscriber_number)}</td><td>${esc(s.subscriber_name)}</td><td class="num muted">${esc(s.meter_number||'—')}</td><td class="num" style="color:var(--danger)">${fmtMoney(s.last_balance)}</td></tr>`).join('')}
          <tr style="background:var(--paper-2); font-weight:800;"><td colspan="3">الإجمالي</td><td class="num">${fmtMoney(total)}</td></tr>
        </tbody>
      </table>`;
  } else if(reportTab==='unpaid'){
    const list = invoiceRows().filter(x=>x.r.status!=='paid');
    if(!list.length){ wrap.innerHTML = emptyReport('لا توجد فواتير غير مسددة', 'كل الفواتير مسددة بالكامل'); return; }
    const total = list.reduce((s,x)=>s+x.r.remaining_amount,0);
    wrap.innerHTML = `
      <table>
        <thead><tr><th>رقم الفاتورة</th><th>المشترك</th><th>الدورة</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
        <tbody>
          ${list.map(({r,sub,cycle})=>`<tr>
            <td class="num muted">${esc(r.invoice_number)}</td><td>${sub?esc(sub.subscriber_name):'—'}</td><td class="muted">${cycle?esc(cycle.cycle_name):'—'}</td>
            <td class="num">${fmtMoney(r.amount_due)}</td><td class="num" style="color:var(--success)">${fmtMoney(r.amount_paid)}</td><td class="num" style="color:var(--danger)">${fmtMoney(r.remaining_amount)}</td>
          </tr>`).join('')}
          <tr style="background:var(--paper-2); font-weight:800;"><td colspan="5">الإجمالي المتبقي</td><td class="num">${fmtMoney(total)}</td></tr>
        </tbody>
      </table>`;
  } else if(reportTab==='consumption'){
    const cycles = [...DB.cycles].sort((a,b)=>b.id-a.id);
    if(!cycles.length){ wrap.innerHTML = emptyReport('لا توجد دورات بعد', ''); return; }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>الدورة</th><th>عدد الفواتير</th><th>إجمالي الاستهلاك (م³)</th><th>قيمة الاستهلاك</th><th>إجمالي المستحق</th><th>المحصّل</th></tr></thead>
        <tbody>
          ${cycles.map(c=>{
            const rs = DB.readings.filter(r=>r.cycle_id===c.id);
            const units = rs.reduce((s,r)=>s+r.total_consumed_units,0);
            const consumption = rs.reduce((s,r)=>s+r.consumption_amount,0);
            const due = rs.reduce((s,r)=>s+r.amount_due,0);
            const paid = rs.reduce((s,r)=>s+r.amount_paid,0);
            return `<tr><td>${esc(c.cycle_name)}</td><td class="num">${rs.length}</td><td class="num">${units}</td><td class="num">${fmtMoney(consumption)}</td><td class="num">${fmtMoney(due)}</td><td class="num" style="color:var(--success)">${fmtMoney(paid)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } else if(reportTab==='collector'){
    renderCollectorReport(wrap);
  }
}
function renderCollectorReport(wrap){
  if(!DB.collectors.length){ wrap.innerHTML = emptyReport('لا يوجد متحصلون بعد', 'أضف متحصلاً من شاشة «المتحصلون» لعرض كشفه هنا'); return; }
  const filterHtml = `
    <div class="toolbar" style="padding:14px 14px 0;">
      <select id="collectorFilterSel" style="max-width:240px;">
        <option value="all">كل المتحصلين</option>
        ${DB.collectors.map(c=>`<option value="${c.id}" ${reportCollectorId===String(c.id)?'selected':''}>${esc(c.collector_name)}</option>`).join('')}
      </select>
    </div>
    <div id="collectorReportBody"></div>
  `;
  wrap.innerHTML = filterHtml;
  document.getElementById('collectorFilterSel').addEventListener('change', (e)=>{ reportCollectorId = e.target.value; renderCollectorReportBody(); });
  renderCollectorReportBody();
}
function renderCollectorReportBody(){
  const body = document.getElementById('collectorReportBody');
  if(!body) return;
  let list = DB.payments.slice();
  if(reportCollectorId!=='all') list = list.filter(p=>String(p.collector_id)===reportCollectorId);
  list = list.filter(p=>p.collector_id); // فقط الدفعات المرتبطة بمتحصل
  list.sort((a,b)=> new Date(b.date) - new Date(a.date));
  if(!list.length){ body.innerHTML = emptyReport('لا توجد دفعات مسجّلة لهذا المتحصل', ''); return; }
  const total = list.reduce((s,p)=>s+p.amount,0);
  body.innerHTML = `
    <table>
      <thead><tr><th>التاريخ</th><th>المتحصل</th><th>المشترك</th><th>رقم الفاتورة</th><th>المبلغ</th><th>ملاحظات</th></tr></thead>
      <tbody>
        ${list.map(p=>{
          const col = DB.collectors.find(c=>c.id===p.collector_id);
          const sub = DB.subscribers.find(s=>s.id===p.subscriber_id);
          const r = DB.readings.find(r=>r.id===p.reading_id);
          return `<tr>
            <td class="muted">${fmtDate(p.date)}</td><td>${col?esc(col.collector_name):'—'}</td><td>${sub?esc(sub.subscriber_name):'—'}</td>
            <td class="num muted">${r?esc(r.invoice_number):'—'}</td><td class="num" style="color:var(--success)">${fmtMoney(p.amount)}</td><td class="muted text-cell">${esc(p.notes||'—')}</td>
          </tr>`;
        }).join('')}
        <tr style="background:var(--paper-2); font-weight:800;"><td colspan="4">الإجمالي</td><td class="num">${fmtMoney(total)}</td><td></td></tr>
      </tbody>
    </table>`;
}
function emptyReport(title, sub){
  return `<div class="empty">${icon('reports')}<b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
}

/* ---------- 12ب) المتحصلون ---------- */
function renderCollectors(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>المتحصلون</h2><p>فريق تحصيل الدفعات الميداني — يظهرون كخيار عند تسجيل أي دفعة</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="addColBtn">${icon('plus')} إضافة متحصل</button></div>
    </div>
    <div class="card"><div class="table-scroll" id="colTableWrap"></div></div>
  `;
  document.getElementById('addColBtn').addEventListener('click', ()=>openCollectorForm());
  renderCollectorsTable();
}
function renderCollectorsTable(){
  const wrap = document.getElementById('colTableWrap');
  if(!DB.collectors.length){ wrap.innerHTML = `<div class="empty">${icon('userCheck')}<b>لا يوجد متحصلون</b><span>يمكنك تسجيل الدفعات مباشرة بدون متحصل، أو إضافة فريق تحصيل هنا</span></div>`; return; }
  wrap.innerHTML = `
    <table><thead><tr><th>الاسم</th><th>الهاتف</th><th>عدد الدفعات المسجّلة</th><th>إجمالي المحصّل</th><th>الحالة</th><th></th></tr></thead>
    <tbody>
      ${DB.collectors.map(c=>{
        const pays = DB.payments.filter(p=>p.collector_id===c.id);
        const total = pays.reduce((s,p)=>s+p.amount,0);
        return `<tr>
          <td>${esc(c.collector_name)}</td><td class="num muted">${esc(c.phone||'—')}</td>
          <td class="num">${pays.length}</td><td class="num" style="color:var(--success)">${fmtMoney(total)}</td>
          <td>${c.is_active!==false?'<span class="badge badge-success">نشط</span>':'<span class="badge badge-muted">متوقف</span>'}</td>
          <td><button class="btn btn-sm btn-ghost" onclick="openCollectorForm(${c.id})">${icon('edit')}</button>
              <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteCollector(${c.id})">${icon('trash')}</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}
function openCollectorForm(id){
  const editing = DB.collectors.find(c=>c.id===id);
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل متحصل':'إضافة متحصل'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field"><label>الاسم</label><input type="text" id="c_name" value="${editing?esc(editing.collector_name):''}"></div>
      <div class="field-row">
        <div class="field"><label>رقم الهاتف</label><input type="tel" id="c_phone" value="${editing?esc(editing.phone||''):''}"></div>
        <div class="field"><label>الحالة</label>
          <select id="c_active"><option value="1" ${!editing||editing.is_active!==false?'selected':''}>نشط</option><option value="0" ${editing&&editing.is_active===false?'selected':''}>متوقف</option></select>
        </div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn btn-primary" id="saveColBtn">${icon('check')} حفظ</button></div>
  `);
  document.getElementById('saveColBtn').addEventListener('click', ()=>{
    const name = document.getElementById('c_name').value.trim();
    if(!name){ toast('أدخل اسم المتحصل', 'error'); return; }
    const payload = { collector_name:name, phone:document.getElementById('c_phone').value.trim(), is_active: document.getElementById('c_active').value==='1' };
    if(editing) Object.assign(editing, payload);
    else DB.collectors.push(Object.assign({id:nextId('collectors')}, payload));
    persist(); closeModal(); toast('تم الحفظ', 'success'); renderCollectorsTable();
  });
}
function deleteCollector(id){
  if(DB.payments.some(p=>p.collector_id===id)){ toast('لا يمكن حذف متحصل له دفعات مسجّلة — يمكنك تعطيله بدلاً من الحذف', 'error'); return; }
  confirmDialog('سيتم حذف هذا المتحصل نهائياً. هل أنت متأكد؟', ()=>{ DB.collectors = DB.collectors.filter(c=>c.id!==id); persist(); toast('تم الحذف', 'success'); renderCollectorsTable(); });
}

/* ---------- 12ج) المستخدمون والصلاحيات ---------- */
const ROLE_LABELS = { admin:'مدير النظام (كل الصلاحيات)', reader:'قارئ عدادات (إدخال القراءات فقط)', collector:'متحصل (الفواتير والدفعات فقط)' };
function renderUsers(root){
  root.innerHTML = `
    <div class="view-head">
      <div><h2>المستخدمون</h2><p>كل مستخدم يدخل باسمه ورقمه السري، وتظهر له الشاشات المسموحة لدوره فقط</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="addUserBtn">${icon('plus')} إضافة مستخدم</button></div>
    </div>
    <div class="card"><div class="table-scroll" id="usersTableWrap"></div></div>
  `;
  document.getElementById('addUserBtn').addEventListener('click', ()=>openUserForm());
  renderUsersTable();
}
function renderUsersTable(){
  const wrap = document.getElementById('usersTableWrap');
  wrap.innerHTML = `
    <table><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
    <tbody>
      ${DB.users.map(u=>`<tr>
        <td>${esc(u.full_name)}</td><td class="num muted">${esc(u.username)}</td><td>${ROLE_LABELS[u.role]||u.role}</td>
        <td>${u.is_active!==false?'<span class="badge badge-success">نشط</span>':'<span class="badge badge-muted">متوقف</span>'}</td>
        <td><button class="btn btn-sm btn-ghost" onclick="openUserForm(${u.id})">${icon('edit')}</button>
            <button class="btn btn-sm btn-ghost btn-danger" onclick="deleteUser(${u.id})">${icon('trash')}</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}
function openUserForm(id){
  const editing = DB.users.find(u=>u.id===id);
  openModal(`
    <div class="modal-head"><h3>${editing?'تعديل مستخدم':'إضافة مستخدم'}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>الاسم الكامل</label><input type="text" id="u_full" value="${editing?esc(editing.full_name):''}"></div>
        <div class="field"><label>اسم الدخول</label><input type="text" id="u_username" value="${editing?esc(editing.username):''}" placeholder="بدون مسافات"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>الرقم السري (4 أرقام على الأقل)</label><input type="text" id="u_pin" value="${editing?esc(editing.pin):''}" placeholder="مثال: 1234"></div>
        <div class="field"><label>الدور</label>
          <select id="u_role">
            <option value="admin" ${editing&&editing.role==='admin'?'selected':''}>مدير النظام</option>
            <option value="reader" ${editing&&editing.role==='reader'?'selected':''}>قارئ عدادات</option>
            <option value="collector" ${editing&&editing.role==='collector'?'selected':''}>متحصل</option>
          </select>
        </div>
      </div>
      <div class="field"><label>الحالة</label>
        <select id="u_active"><option value="1" ${!editing||editing.is_active!==false?'selected':''}>نشط</option><option value="0" ${editing&&editing.is_active===false?'selected':''}>متوقف</option></select>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>إلغاء</button><button class="btn btn-primary" id="saveUserBtn">${icon('check')} حفظ</button></div>
  `);
  document.getElementById('saveUserBtn').addEventListener('click', ()=>{
    const full = document.getElementById('u_full').value.trim();
    const username = document.getElementById('u_username').value.trim();
    const pin = document.getElementById('u_pin').value.trim();
    if(!full || !username){ toast('يرجى تعبئة الاسم واسم الدخول', 'error'); return; }
    if(pin.length < 4){ toast('الرقم السري يجب ألا يقل عن 4 أرقام', 'error'); return; }
    if(DB.users.some(u=>u.username===username && (!editing || u.id!==editing.id))){ toast('اسم الدخول مستخدم بالفعل', 'error'); return; }
    const payload = { full_name:full, username, pin, role:document.getElementById('u_role').value, is_active: document.getElementById('u_active').value==='1' };
    if(editing) Object.assign(editing, payload);
    else DB.users.push(Object.assign({id:nextId('users')}, payload));
    persist(); closeModal(); toast('تم الحفظ', 'success'); renderUsersTable();
  });
}
function deleteUser(id){
  const admins = DB.users.filter(u=>u.role==='admin' && u.is_active!==false);
  const target = DB.users.find(u=>u.id===id);
  if(target.role==='admin' && admins.length<=1){ toast('لا يمكن حذف آخر حساب مدير في النظام', 'error'); return; }
  confirmDialog('سيتم حذف هذا المستخدم نهائياً. هل أنت متأكد؟', ()=>{ DB.users = DB.users.filter(u=>u.id!==id); persist(); toast('تم الحذف', 'success'); renderUsersTable(); });
}

/* ---------- 13) الإعدادات ---------- */
function renderStorageKindBadge(){
  const kind = Backend.kind;
  const map = {
    device: { label: 'مُفعَّل: تخزين حقيقي على ذاكرة الجهاز (Capacitor Filesystem)', cls:'badge-success', icon:'shield' },
    localStorage: { label: 'وضع اختبار المتصفح — حالياً يُحفظ في localStorage. سيتحوّل تلقائياً لتخزين الجهاز الحقيقي بعد تحويله إلى APK عبر Capacitor', cls:'badge-amber', icon:'droplet' },
    memory: { label: 'وضع معاينة مؤقت — لا يُحفظ بين الجلسات (هذه نسخة تجريبية داخل المحادثة فقط)', cls:'badge-muted', icon:'droplet' }
  };
  const info = map[kind] || map.memory;
  return `<div class="badge ${info.cls}" style="display:flex; align-items:center; gap:6px; padding:7px 12px; margin-bottom:12px; white-space:normal; text-align:right; line-height:1.6;">${icon(info.icon)}<span>${info.label}</span></div>`;
}
function renderSettings(root){
  root.innerHTML = `
    <div class="view-head"><div><h2>الإعدادات</h2><p>بيانات المنشأة والنسخ الاحتياطي لبياناتك</p></div></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>بيانات المنشأة</h3></div>
        <div class="card-pad">
          <div class="field"><label>اسم المنشأة (يظهر على الفواتير)</label><input type="text" id="s_org" value="${esc(DB.settings.org_name)}"></div>
          <div class="field"><label>الوصف الفرعي</label><input type="text" id="s_sub" value="${esc(DB.settings.org_sub||'')}"></div>
          <div class="field"><label>وحدة العملة</label><input type="text" id="s_currency" value="${esc(DB.settings.currency)}"></div>
          <button class="btn btn-primary" id="saveSettingsBtn">${icon('check')} حفظ التغييرات</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>النسخ الاحتياطي</h3></div>
        <div class="card-pad">
          ${renderStorageKindBadge()}
          <p style="font-size:12.5px; color:var(--ink-soft); line-height:1.7; margin-top:0;">
            ${CFG.PERSIST ? 'بياناتك محفوظة تلقائياً على هذا الجهاز. يُنصح بأخذ نسخة احتياطية دورياً كملف JSON.' : 'هذه معاينة تجريبية داخل المحادثة ولا تُحفظ تلقائياً بين الجلسات — نزّل نسخة المشروع الكاملة لتشغيل تطبيق يحفظ بياناتك فعلياً على جهازك.'}
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn" id="exportBtn">${icon('download')} تصدير نسخة احتياطية</button>
            <label class="btn" style="cursor:pointer;">${icon('upload')} استيراد نسخة احتياطية<input type="file" id="importFile" accept="application/json" style="display:none;"></label>
          </div>
          <hr style="border:none; border-top:1px solid var(--line); margin:18px 0;">
          <button class="btn btn-danger" id="resetBtn">${icon('trash')} مسح جميع البيانات والبدء من جديد</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('saveSettingsBtn').addEventListener('click', ()=>{
    DB.settings.org_name = document.getElementById('s_org').value.trim() || 'مؤسسة نبع';
    DB.settings.org_sub = document.getElementById('s_sub').value.trim();
    DB.settings.currency = document.getElementById('s_currency').value.trim() || 'ريال';
    persist(); toast('تم حفظ الإعدادات', 'success');
  });
  document.getElementById('exportBtn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(DB, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'نسخة_احتياطية_' + todayISO() + '.json';
    a.click();
    toast('تم تنزيل النسخة الاحتياطية', 'success');
  });
  document.getElementById('importFile').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        const parsed = JSON.parse(ev.target.result);
        if(!parsed.subscribers || !parsed.settings){ throw new Error('bad shape'); }
        DB = parsed; persist(); toast('تم استيراد البيانات بنجاح', 'success');
        navigate('dashboard');
      }catch(err){ toast('ملف غير صالح لا يمكن استيراده', 'error'); }
    };
    reader.readAsText(file);
  });
  document.getElementById('resetBtn').addEventListener('click', ()=>{
    confirmDialog('سيتم حذف جميع البيانات (المشتركين، الدورات، الفواتير) نهائياً. هل أنت متأكد تماماً؟', ()=>{
      DB = emptyDB(); persist(); toast('تم مسح جميع البيانات', 'success'); navigate('dashboard');
    });
  });
}

/* ---------- 14) تسجيل الدخول (بسيط - لفصل الأدوار على جهاز مشترك) ---------- */
function showLoginScreen(){
  const activeUsers = DB.users.filter(u=>u.is_active!==false);
  document.getElementById('sidebar').style.display = 'none';
  document.querySelector('.topbar').style.display = 'none';
  const roleLabels = { admin:'مدير النظام', reader:'قارئ عدادات', collector:'متحصل' };
  document.getElementById('content').innerHTML = `
    <div style="max-width:420px; margin:60px auto 0;">
      <div style="text-align:center; margin-bottom:22px;">
        <div style="width:56px; height:56px; border-radius:14px; background:var(--aqua); display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
          ${icon('droplet').replace('currentColor','#fff')}
        </div>
        <h2 style="margin:0 0 4px;">تسجيل الدخول</h2>
        <p style="margin:0; font-size:12.5px; color:var(--ink-soft);">اختر حسابك للمتابعة</p>
      </div>
      <div class="card">
        <div class="card-pad" style="display:flex; flex-direction:column; gap:8px;" id="userList">
          ${activeUsers.map(u=>`
            <button class="btn" style="justify-content:flex-start; padding:12px 14px;" data-uid="${u.id}">
              ${icon('userCheck')}
              <span style="text-align:right;">
                <b style="display:block; font-size:13.5px;">${esc(u.full_name)}</b>
                <span style="font-size:11px; color:var(--ink-faint); font-weight:600;">${roleLabels[u.role]||u.role}</span>
              </span>
            </button>
          `).join('') || '<p class="muted" style="text-align:center;">لا يوجد مستخدمون نشطون</p>'}
        </div>
      </div>
      <p style="text-align:center; font-size:11px; color:var(--ink-faint); margin-top:16px;">نظام نبع — تسجيل دخول محلي بسيط لفصل الصلاحيات على نفس الجهاز، وليس تشفيراً أمنياً</p>
    </div>
  `;
  document.querySelectorAll('#userList [data-uid]').forEach(btn=>{
    btn.addEventListener('click', ()=> promptPin(Number(btn.dataset.uid)));
  });
}
function promptPin(userId){
  const user = DB.users.find(u=>u.id===userId);
  openModal(`
    <div class="modal-head"><h3>الرقم السري — ${esc(user.full_name)}</h3><button class="btn btn-icon btn-ghost" data-close>${icon('close')}</button></div>
    <div class="modal-body">
      <div class="field"><label>أدخل الرقم السري (4 أرقام)</label><input type="text" id="pinInput" maxlength="8" placeholder="••••" autocomplete="off"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-close>إلغاء</button>
      <button class="btn btn-primary" id="pinSubmit">${icon('check')} دخول</button>
    </div>
  `);
  const submit = ()=>{
    const val = document.getElementById('pinInput').value.trim();
    if(val === String(user.pin)){
      CURRENT_USER = user;
      closeModal();
      startApp();
    }else{
      toast('رقم سري غير صحيح', 'error');
    }
  };
  document.getElementById('pinSubmit').addEventListener('click', submit);
  document.getElementById('pinInput').addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
  document.getElementById('pinInput').focus();
}
function logout(){
  CURRENT_USER = null;
  showLoginScreen();
}
function startApp(){
  document.getElementById('sidebar').style.display = '';
  document.querySelector('.topbar').style.display = '';
  renderNav();
  navigate('dashboard');
}

/* ---------- 15) التهيئة ---------- */
function showLoadingScreen(){
  document.getElementById('sidebar').style.display = 'none';
  document.querySelector('.topbar').style.display = 'none';
  document.getElementById('content').innerHTML = `
    <div style="text-align:center; padding:120px 20px; color:var(--ink-soft);">
      <div style="width:36px; height:36px; border:3px solid var(--line); border-top-color:var(--aqua); border-radius:50%; margin:0 auto 14px; animation: spin 0.8s linear infinite;"></div>
      <div style="font-size:13px; font-weight:700;">جاري تحميل البيانات المحفوظة...</div>
    </div>
    <style>@keyframes spin{ to{ transform:rotate(360deg); } }</style>
  `;
}

async function init(){
  showLoadingScreen();
  await loadDB();

  if(!DB.subscription_types.length && !DB.subscribers.length && CFG.AUTO_SEED){
    seedDemoData();
    await persist();
  }
  if(!DB.users || !DB.users.length){ DB.users = emptyDB().users; await persist(); }

  if(CFG.REQUIRE_LOGIN === false){
    // وضع المعاينة السريعة: يدخل مباشرة كمدير بدون شاشة تسجيل دخول
    CURRENT_USER = DB.users.find(u=>u.role==='admin') || DB.users[0];
    startApp();
  }else{
    showLoginScreen();
  }

  if(CFG.PERSIST && 'serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    });
  }
}
init();
