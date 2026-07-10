/* ---------- 7ب) استيراد/تصدير Excel (xlsx) للمشتركين والقراءات ---------- */
const XLSX_HEADERS = ['اسم المشترك','رقم العداد','نوع الاشتراك','المنطقة','المربع','آخر قراءة','رصيد سابق','الهاتف'];
const XLSX_READINGS_HEADERS = ['رقم المشترك','اسم المشترك','رقم العداد','القراءة السابقة','القراءة الحالية','وحدات تقديرية','ملاحظات'];

function isXlsxReady(){
  return typeof XLSX !== 'undefined' && XLSX && XLSX.utils;
}

/* تحميل قالب استيراد المشتركين */
function downloadXlsxTemplate(){
  if(!isXlsxReady()){ toast('⚠️ مكتبة Excel لم تُحمّل بعد، جاري المحاولة من الإنترنت...', 'error'); return; }
  const sample = { 'اسم المشترك':'محمد أحمد علي', 'رقم العداد':'1_50', 'نوع الاشتراك':'منزلي', 'المنطقة':'حي النور', 'المربع':'مربع 1', 'آخر قراءة':0, 'رصيد سابق':0, 'الهاتف':'777000000' };
  const ws = XLSX.utils.json_to_sheet([sample], { header: XLSX_HEADERS });
  ws['!cols'] = XLSX_HEADERS.map(()=>({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المشتركون');
  XLSX.writeFile(wb, 'قالب_استيراد_المشتركين.xlsx');
}

/* تحميل قالب القراءات مع بيانات المشتركين الحالية */
function downloadReadingsTemplate(){
  if(!isXlsxReady()){ toast('⚠️ مكتبة Excel لم تُحمّل بعد، جاري المحاولة من الإنترنت...', 'error'); return; }
  const openCycle = DB.cycles.find(c=>c.status==='open');
  if(!openCycle){ toast('⚠️ لا توجد دورة قراءة مفتوحة حالياً', 'error'); return; }
  
  const rows = DB.subscribers.filter(s=>s.status==='active').map(s=>{
    // تحقق إذا كانت هناك قراءة مدخلة بالفعل لهذا المشترك في الدورة الحالية
    const existingReading = DB.readings.find(r=>r.subscriber_id===s.id && r.cycle_id===openCycle.id);
    return {
      'رقم المشترك': s.subscriber_number,
      'اسم المشترك': s.subscriber_name,
      'رقم العداد': s.meter_number || '',
      'القراءة السابقة': existingReading ? existingReading.current_reading : s.last_reading_value,
      'القراءة الحالية': existingReading ? existingReading.current_reading : '',
      'وحدات تقديرية': existingReading ? existingReading.estimated_units : 0,
      'ملاحظات': existingReading ? '✓ مسجّلة' : 'أدخل القراءة الحالية'
    };
  });
  
  if(!rows.length){ toast('لا يوجد مشتركون نشطون', 'error'); return; }
  
  const ws = XLSX.utils.json_to_sheet(rows, { header: XLSX_READINGS_HEADERS });
  ws['!cols'] = XLSX_READINGS_HEADERS.map(()=>({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'القراءات');
  XLSX.writeFile(wb, `قالب_قراءات_${openCycle.cycle_name.replace(/\//g, '_')}_${todayISO()}.xlsx`);
  toast('تم تحميل قالب القراءات بنجاح', 'success');
}

/* تحميل جميع المشتركين كـ Excel */
function downloadSubscribersXlsx(){
  if(!isXlsxReady()){ toast('⚠️ مكتبة Excel لم تُحمّل بعد، جاري المحاولة من الإنترنت...', 'error'); return; }
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
  ws['!cols'] = ['رقم المشترك','اسم المشترك','رقم العداد','نوع الاش��راك','المنطقة','المربع','آخر قراءة','رصيد سابق','الهاتف','الحالة'].map(()=>({wch:16}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'المشتركون');
  XLSX.writeFile(wb, 'المشتركون_' + todayISO() + '.xlsx');
  toast('تم تحميل بيانات المشتركين بنجاح', 'success');
}

/* استيراد المشتركين من Excel */
function handleXlsxImport(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!isXlsxReady()){ toast('⚠️ مكتبة Excel لم تُحمّل بعد، تحقق من الاتصال بالإنترنت أو أعد فتح الصفحة', 'error'); e.target.value=''; return; }
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
      toast(`✅ تم استيراد ${added} مشترك${skipped?`، وتخطي ${skipped} (تحقق من اسم نوع الاشتراك)`:''}`, added?'success':'error');
      renderSubTable();
    }catch(err){
      console.warn(err);
      toast('❌ تعذّرت قراءة الملف — تأكد أنه بصيغة Excel (xlsx) صحيحة', 'error');
    }
    e.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

/* استيراد القراءات من Excel */
function handleReadingsXlsxImport(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!isXlsxReady()){ toast('⚠️ مكتبة Excel لم تُحمّل بعد', 'error'); e.target.value=''; return; }
  
  const openCycle = DB.cycles.find(c=>c.status==='open');
  if(!openCycle){ toast('❌ لا توجد دورة قراءة مفتوحة', 'error'); e.target.value=''; return; }
  
  const reader = new FileReader();
  reader.onload = (ev)=>{
    try{
      const wb = XLSX.read(ev.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      if(!rows.length){ toast('الملف فارغ أو بدون بيانات', 'error'); e.target.value=''; return; }
      
      let added = 0, updated = 0, skipped = 0;
      rows.forEach(row=>{
        const subNumber = String(row['رقم المشترك']||'').trim();
        const currReading = Number(row['القراءة الحالية']||'');
        const estimated = Number(row['وحدات تقديرية']||0);
        const notes = String(row['ملاحظات']||'').trim();
        
        if(!subNumber || currReading === ''){ skipped++; return; }
        
        const sub = DB.subscribers.find(s=>s.subscriber_number===subNumber);
        if(!sub){ skipped++; return; }
        
        const type = DB.subscription_types.find(t=>t.id===sub.subscription_type_id);
        const existing = DB.readings.find(r=>r.subscriber_id===sub.id && r.cycle_id===openCycle.id);
        
        if(existing){
          // تحديث قراءة موجودة
          existing.current_reading = currReading;
          existing.estimated_units = estimated;
          existing.unit_price = type ? type.unit_price : 0;
          existing.monthly_fee = type ? type.monthly_fee : 0;
          if(notes && !notes.includes('مسجّل��')) existing.notes = notes;
          recalcReading(existing);
          updated++;
        }else{
          // إنشاء قراءة جديدة
          const prevReading = sub.last_reading_value;
          const r = buildReading(sub, openCycle, type, prevReading, currReading, estimated, sub.last_balance || 0);
          if(notes && !notes.includes('مسجّلة')) r.notes = notes;
          recalcReading(r);
          DB.readings.push(r);
          added++;
        }
      });
      
      persist();
      toast(`✅ تم معالجة ${added + updated} قراءة (${added} جديدة، ${updated} محدثة)${skipped?`، وتخطي ${skipped}`:''}`, (added+updated)>0?'success':'error');
      renderReadings(document.getElementById('viewRoot'));
    }catch(err){
      console.warn(err);
      toast('❌ تعذّرت قراءة الملف', 'error');
    }
    e.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}
