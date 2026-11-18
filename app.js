(function(){
'use strict';
var VIEWS=['kasir','booking','layar','setelan'];
var DEFAULT_CFG={
  shop:'Barbershop Kita',open:'10:00',close:'20:00',wa:'',
  barbers:[{id:'b1',name:'Kapster 1'},{id:'b2',name:'Kapster 2'},{id:'b3',name:'Kapster 3'}],
  services:{biasa:{label:'Potong biasa',price:20000,min:20},keramas:{label:'Potong + keramas',price:25000,min:30}},
  slotMin:30,peakStart:'14:00',peakEnd:'16:00',walkinShare:35
};
var cfg=clone(DEFAULT_CFG),items=[],db=null,user=null,readOnly=false;
var notes={net:'',ro:''},sel={slot:null},lastWalkin=null,lastBooking=null,cfgLoaded=false;

function clone(o){return JSON.parse(JSON.stringify(o))}
function $(s){return document.querySelector(s)}
function pad(n){return String(n).padStart(2,'0')}
function el(tag,attrs){
  var e=document.createElement(tag);attrs=attrs||{};
  Object.keys(attrs).forEach(function(k){var v=attrs[k];
    if(k==='class')e.className=v;
    else if(k.indexOf('on')===0)e.addEventListener(k.slice(2),v);
    else if(v===true)e.setAttribute(k,'');
    else if(v!==false&&v!=null)e.setAttribute(k,v)});
  for(var i=2;i<arguments.length;i++){(function add(c){
    if(c==null||c===false)return;
    if(Array.isArray(c)){c.forEach(add);return}
    e.append(c.nodeType?c:document.createTextNode(String(c)))})(arguments[i])}
  return e;
}
function rp(n){return 'Rp'+Math.round(n).toLocaleString('id-ID')}
function dateStr(ms){var d=new Date(ms);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function todayStr(){return dateStr(Date.now())}
function hm(ms){var d=new Date(ms);return pad(d.getHours())+'.'+pad(d.getMinutes())}
function minsOf(t){var p=String(t||'0:0').split(':');return (+p[0]||0)*60+(+p[1]||0)}
function slotTs(date,mins){var p=date.split('-');return new Date(+p[0],+p[1]-1,+p[2],Math.floor(mins/60),mins%60).getTime()}
function dayLabel(date){var p=date.split('-');return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'})}
function dur(it){var s=cfg.services[it.service];return (s&&s.min)||20}
function svcLabel(k){var s=cfg.services[k];return s?s.label:k}
function barberName(id){var b=cfg.barbers.filter(function(x){return x.id===id})[0];return b?b.name:''}
function firstName(n){return String(n||'').trim().split(/\s+/)[0]||'Pelanggan'}
function phoneIntl(p){var d=String(p||'').replace(/\D/g,'');if(!d)return '';if(d.indexOf('62')===0)return d;if(d[0]==='0')return '62'+d.slice(1);return '62'+d}
function waLink(phone,text){var n=phoneIntl(phone);return n?'https://wa.me/'+n+'?text='+encodeURIComponent(text):''}
function toast(msg){var t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){t.hidden=true},3200)}
function errMsg(e){var c=e&&e.code;
  if(c==='quota_exceeded')return 'Penyimpanan penuh. Hapus data lama dulu.';
  if(c==='invalid_argument')return 'Akun ini belum boleh mengubah data. Minta akses Contributor.';
  if(c==='not_granted'||c==='capability_disabled')return 'Penyimpanan belum tersambung.';
  return 'Gagal menyimpan. Coba lagi.'}
function mergeCfg(s){
  var c=clone(DEFAULT_CFG);s=s||{};
  Object.keys(s).forEach(function(k){
    if(k==='services'){Object.keys(s.services||{}).forEach(function(sk){c.services[sk]=Object.assign({},c.services[sk],s.services[sk])})}
    else if(k==='barbers'){if(Array.isArray(s.barbers)&&s.barbers.length)c.barbers=s.barbers}
    else c[k]=s[k]});
  return c;
}

/* ---------- antrean: urutan dan estimasi ---------- */
function dueOf(it){return it.type==='booking'&&it.slot?it.slot:it.createdAt}
function todays(){var t=todayStr();return items.filter(function(i){return i.date===t})}
function simulate(now){
  var free={},est={},all=todays();
  cfg.barbers.forEach(function(b){free[b.id]=now});
  all.filter(function(i){return i.status==='serving'&&free[i.barberAssigned]!==undefined}).forEach(function(i){
    free[i.barberAssigned]=Math.max(now,(i.startedAt||now)+dur(i)*60000)});
  var queue=all.filter(function(i){return i.status==='waiting'}).map(function(i){return {it:i,due:dueOf(i)}});
  queue.push({it:{id:'__new',service:'biasa',barber:'any',type:'walkin'},due:now});
  queue.sort(function(a,b){return a.due-b.due});
  var newWait=0;
  queue.forEach(function(q){
    var it=q.it,pool=(it.barber&&it.barber!=='any'&&free[it.barber]!==undefined)?[it.barber]:cfg.barbers.map(function(b){return b.id});
    var best=pool.reduce(function(a,b){return free[b]<free[a]?b:a});
    var start=Math.max(free[best],it.type==='booking'&&it.slot?it.slot:now);
    est[it.id]={start:start,barber:best};
    free[best]=start+dur(it)*60000;
    if(it.id==='__new')newWait=Math.max(0,Math.round((start-now)/60000));
  });
  return {est:est,newWait:newWait};
}
function waitText(m){if(m<=5)return 'Langsung dilayani';return '±'+(Math.round(m/5)*5)+' menit'}
function nextFor(barberId){
  return todays().filter(function(i){return i.status==='waiting'&&(i.barber==='any'||!i.barber||i.barber===barberId)})
    .sort(function(a,b){return dueOf(a)-dueOf(b)})[0]||null;
}
function nextNum(type,date){
  var m=0;items.forEach(function(i){if(i.date===date&&i.type===type&&i.num>m)m=i.num});return m+1;
}
function write(fn){
  if(!db){toast('Penyimpanan belum tersambung.');return Promise.resolve()}
  return Promise.resolve().then(fn).catch(function(e){toast(errMsg(e))});
}
function setStatus(it,patch){return write(function(){return db.doc('queue/'+it.id).update(patch)})}
function callNext(barberId){
  var n=nextFor(barberId);if(!n)return;
  setStatus(n,{status:'serving',barberAssigned:barberId,startedAt:Date.now()});
}

/* ---------- pesan WhatsApp ---------- */
function msgFor(it,est){
  var shop=cfg.shop;
  if(it.type==='booking'){
    return 'Halo '+firstName(it.name)+', booking di '+shop+' sudah tercatat.\nNomor: '+it.code+'\nJam: '+hm(it.slot)+' ('+dayLabel(it.date)+')\nLayanan: '+svcLabel(it.service)+
      '\nMohon datang 10 menit sebelum jam booking. Jika telat lebih dari 10 menit, slot bisa dialihkan. Batal? Kabari minimal 1 jam sebelumnya.';
  }
  return 'Halo '+firstName(it.name)+', nomor antrean Anda di '+shop+' adalah '+it.code+'.\nPerkiraan giliran sekitar jam '+(est?hm(est.start):'-')+
    '. Silakan menunggu di sekitar toko, kami kabari sekitar 10 menit sebelum giliran Anda.';
}
function resultPanel(it,est){
  var msg=msgFor(it,est),ta=el('textarea',{readonly:true,rows:4,'aria-label':'Pesan WhatsApp'});ta.value=msg;
  ta.addEventListener('focus',function(){ta.select()});
  var link=waLink(it.phone,msg);
  var title=it.type==='booking'?'Booking tersimpan: '+hm(it.slot)+', '+dayLabel(it.date):'Perkiraan giliran '+(est?hm(est.start):'-')+(est?' ('+barberName(est.barber)+')':'');
  return el('div',{class:'result'},
    el('div',{class:'head'},el('span',{class:'code'},it.code),el('b',null,title)),
    el('span',{class:'small muted'},'Pesan untuk pelanggan:'),ta,
    el('div',{class:'row'},
      el('button',{class:'btn small',type:'button',onclick:function(){
        if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(msg).then(function(){toast('Pesan tersalin')},function(){ta.focus();ta.select();toast('Salin manual dari kotak pesan')})}
        else{ta.focus();ta.select();toast('Salin manual dari kotak pesan')}}},'Salin pesan'),
      link?el('a',{class:'btn small',href:link,target:'_blank',rel:'noopener'},'Buka WhatsApp'):el('span',{class:'small muted'},'Isi nomor WA untuk tombol WhatsApp'),
      el('button',{class:'btn small',type:'button',onclick:function(){if(it.type==='booking')lastBooking=null;else lastWalkin=null;render()}},'Tutup')));
}

/* ---------- render: kasir ---------- */
function renderKasir(){
  var now=Date.now(),sim=simulate(now),all=todays();
  var waiting=all.filter(function(i){return i.status==='waiting'}).sort(function(a,b){return dueOf(a)-dueOf(b)});
  var serving=all.filter(function(i){return i.status==='serving'});
  var done=all.filter(function(i){return i.status==='done'}).sort(function(a,b){return (b.doneAt||0)-(a.doneAt||0)});
  var revenue=done.reduce(function(s,i){var v=cfg.services[i.service];return s+(v?v.price:0)},0);
  var avg=done.filter(function(i){return i.startedAt&&i.doneAt}).map(function(i){return (i.doneAt-i.startedAt)/60000});
  var avgTxt=avg.length?Math.round(avg.reduce(function(a,b){return a+b},0)/avg.length)+' mnt rata-rata layanan':'Belum ada layanan selesai';

  function tile(k,v,s){return el('div',{class:'stat'},el('div',{class:'k'},k),el('div',{class:'v'},v),el('div',{class:'s'},s))}
  var st=$('#stats');st.replaceChildren(
    tile('Menunggu',String(waiting.length),'orang di antrean'),
    tile('Sedang dilayani',serving.length+'/'+cfg.barbers.length,'kursi terisi'),
    tile('Selesai',String(done.length),rp(revenue)+' · '+avgTxt),
    tile('Tunggu walk-in baru',sim.newWait<=5?'Langsung':'±'+(Math.round(sim.newWait/5)*5)+' mnt','perkiraan jika datang sekarang'));

  var ch=$('#chairs');ch.replaceChildren();
  cfg.barbers.forEach(function(b){
    var cur=serving.filter(function(i){return i.barberAssigned===b.id})[0];
    if(cur){
      var el_=(now-(cur.startedAt||now))/60000,d=dur(cur),pct=Math.min(100,Math.round(el_/d*100));
      ch.append(el('div',{class:'chair busy'},
        el('div',{class:'who'},el('span',null,b.name),el('span',null,Math.floor(el_)+' / '+d+' mnt')),
        el('div',{class:'code big'},cur.code),
        el('div',null,el('b',null,cur.name),el('span',{class:'muted'},' · '+svcLabel(cur.service))),
        el('div',{class:'bar'+(el_>d?' over':'')},el('i',{style:'width:'+pct+'%'})),
        el('button',{class:'btn primary',type:'button',disabled:readOnly,onclick:function(){setStatus(cur,{status:'done',doneAt:Date.now()})}},'Selesai')));
    }else{
      var n=nextFor(b.id);
      ch.append(el('div',{class:'chair'},
        el('div',{class:'who'},el('span',null,b.name),el('span',null,'Kosong')),
        n?el('div',null,el('span',{class:'muted small'},'Berikutnya'),el('div',null,el('span',{class:'code'},n.code),' · ',el('b',null,n.name))):el('div',{class:'muted'},'Tidak ada yang menunggu'),
        el('button',{class:'btn primary',type:'button',disabled:!n||readOnly,onclick:function(){callNext(b.id)}},'Panggil berikutnya')));
    }
  });

  $('#waitCount').textContent=waiting.length?waiting.length+' orang':'';
  var wl=$('#waitList');wl.replaceChildren();
  if(!waiting.length)wl.append(el('div',{class:'empty'},'Belum ada antrean. Pelanggan yang datang langsung atau booking lewat WA akan muncul di sini.'));
  waiting.forEach(function(it){
    var e=sim.est[it.id],late=it.type==='booking'&&it.slot&&now>it.slot+10*60000;
    var phoneLink=waLink(it.phone,'Halo '+firstName(it.name)+', sebentar lagi giliran Anda di '+cfg.shop+' (nomor '+it.code+'). Mohon bersiap ya.');
    wl.append(el('div',{class:'item'},
      el('div',{class:'code'},it.code),
      el('div',{class:'main'},
        el('b',null,it.name),
        el('span',{class:'chip '+(it.type==='booking'?'book':'')},it.type==='booking'?'Booking '+hm(it.slot):'Walk-in'),
        late?el('span',{class:'chip warn'},'Telat'):null,
        it.isExample?el('span',{class:'chip ex'},'Contoh'):null,
        el('div',{class:'small muted'},svcLabel(it.service)+(it.barber&&it.barber!=='any'?' · minta '+barberName(it.barber):'')+(e?' · perkiraan '+hm(e.start)+' ('+barberName(e.barber)+')':''))),
      el('div',{class:'acts'},
        phoneLink?el('a',{class:'btn small',href:phoneLink,target:'_blank',rel:'noopener'},'Kabari WA'):null,
        el('button',{class:'btn small',type:'button',disabled:readOnly,onclick:function(){setStatus(it,{status:'noshow'})}},'Tidak datang'),
        el('button',{class:'btn small danger',type:'button',disabled:readOnly,onclick:function(){setStatus(it,{status:'cancelled'})}},'Batal'))));
  });

  $('#doneCount').textContent=done.length?done.length+' orang':'';
  var dl=$('#doneList');dl.replaceChildren();
  if(!done.length)dl.append(el('div',{class:'empty'},'Belum ada yang selesai hari ini.'));
  done.slice(0,8).forEach(function(it){
    var m=it.startedAt&&it.doneAt?Math.round((it.doneAt-it.startedAt)/60000):null;
    dl.append(el('div',{class:'item'},
      el('div',{class:'code'},it.code),
      el('div',{class:'main'},el('b',null,it.name),it.isExample?el('span',{class:'chip ex'},'Contoh'):null,
        el('div',{class:'small muted'},svcLabel(it.service)+' · '+barberName(it.barberAssigned)+(m!==null?' · '+m+' menit':''))),
      el('span',{class:'chip good'},rp((cfg.services[it.service]||{}).price||0))));
  });

  var ex=items.filter(function(i){return i.isExample});
  $('#exampleBar').replaceChildren(ex.length?el('div',{class:'row',style:'align-items:center'},
    el('span',{class:'small muted'},'Data contoh masih ada ('+ex.length+'). Hapus sebelum dipakai sungguhan.'),
    el('button',{class:'btn small danger',type:'button',disabled:readOnly,onclick:clearExamples},'Hapus data contoh')):'');

  var wr=$('#wResult');wr.replaceChildren();
  if(lastWalkin){var w=items.filter(function(i){return i.id===lastWalkin})[0];if(w)wr.append(resultPanel(w,sim.est[w.id]))}
}
function clearExamples(){
  var ex=items.filter(function(i){return i.isExample});
  write(function(){return ex.reduce(function(p,it){return p.then(function(){return db.doc('queue/'+it.id).delete()})},Promise.resolve())}).then(function(){toast('Data contoh dihapus')});
}

/* ---------- render: booking ---------- */
function capFor(ts){
  var n=cfg.barbers.length,m=(new Date(ts).getHours())*60+new Date(ts).getMinutes();
  var peak=m>=minsOf(cfg.peakStart)&&m<minsOf(cfg.peakEnd);
  return {peak:peak,cap:peak?Math.max(1,Math.round(n*(1-(+cfg.walkinShare||0)/100))):n};
}
function renderSlots(){
  var date=$('#bDate').value||todayStr(),barber=$('#bBarber').value||'any',now=Date.now();
  var box=$('#slots');box.replaceChildren();
  var active=items.filter(function(i){return i.date===date&&i.type==='booking'&&(i.status==='waiting'||i.status==='serving'||i.status==='done')});
  var step=+cfg.slotMin||30,o=minsOf(cfg.open),c=minsOf(cfg.close),any=false,stillOk=false;
  for(var m=o;m+step<=c;m+=step){(function(m){
    var ts=slotTs(date,m),info=capFor(ts);
    var used=active.filter(function(i){return i.slot===ts}).length;
    var barberTaken=barber!=='any'&&active.some(function(i){return i.slot===ts&&i.barber===barber});
    var left=info.cap-used,past=ts<now,full=left<=0||barberTaken;
    var dis=past||full;if(!dis)any=true;if(ts===sel.slot&&!dis)stillOk=true;
    box.append(el('button',{type:'button',class:'slot'+(info.peak?' peak':''),disabled:dis,'aria-pressed':sel.slot===ts?'true':'false',
      onclick:function(){sel.slot=ts;renderSlots()}},
      el('b',null,hm(ts)),el('span',null,past?'lewat':full?'penuh':(info.peak?'sibuk · ':'')+'sisa '+left)));
  })(m)}
  if(!stillOk)sel.slot=null;
  $('#slotHint').textContent=info_hint(any);
}
function info_hint(any){
  var share=+cfg.walkinShare||0;
  return (any?'':'Tidak ada slot kosong untuk tanggal ini. ')+'Jam sibuk '+cfg.peakStart+'–'+cfg.peakEnd+' (latar kuning): '+share+'% kapasitas disisakan untuk walk-in.';
}
function renderBookList(){
  var date=$('#bDate').value||todayStr();
  $('#bListDate').textContent=dayLabel(date);
  var list=items.filter(function(i){return i.date===date&&i.type==='booking'&&(i.status==='waiting'||i.status==='serving')}).sort(function(a,b){return a.slot-b.slot});
  var box=$('#bList');box.replaceChildren();
  if(!list.length)box.append(el('div',{class:'empty'},'Belum ada booking untuk tanggal ini.'));
  list.forEach(function(it){
    box.append(el('div',{class:'item'},el('div',{class:'code'},it.code),
      el('div',{class:'main'},el('b',null,it.name),it.isExample?el('span',{class:'chip ex'},'Contoh'):null,
        el('div',{class:'small muted'},hm(it.slot)+' · '+svcLabel(it.service)+(it.barber&&it.barber!=='any'?' · '+barberName(it.barber):''))),
      el('button',{class:'btn small danger',type:'button',disabled:readOnly,onclick:function(){setStatus(it,{status:'cancelled'})}},'Batal')));
  });
}
function renderBooking(){
  renderSlots();renderBookList();
  var br=$('#bResult');br.replaceChildren();
  if(lastBooking){var b=items.filter(function(i){return i.id===lastBooking})[0];if(b)br.append(resultPanel(b,null))}
}

/* ---------- render: layar ---------- */
function renderLayar(){
  var now=Date.now(),sim=simulate(now),all=todays();
  var serving=all.filter(function(i){return i.status==='serving'});
  var waiting=all.filter(function(i){return i.status==='waiting'}).sort(function(a,b){return dueOf(a)-dueOf(b)});
  var v=$('#v-layar'),tv=el('div',{class:'tv'});
  tv.append(el('div',{class:'wait'},el('div',null,el('div',{class:'k'},'Perkiraan tunggu jika datang sekarang'),el('div',{class:'v'},sim.newWait<=5?'Langsung dilayani':'±'+(Math.round(sim.newWait/5)*5)+' menit')),
    el('div',{class:'k'},waiting.length+' orang menunggu')));
  var nowBox=el('div',{class:'now'});
  cfg.barbers.forEach(function(b){
    var cur=serving.filter(function(i){return i.barberAssigned===b.id})[0];
    nowBox.append(el('div',{class:'chair'+(cur?' busy':'')},el('div',{class:'who'},el('span',null,b.name),el('span',null,cur?'Sedang dilayani':'Kosong')),
      el('div',{class:'code big'},cur?cur.code:'—'),cur?el('div',null,firstName(cur.name)):el('div',{class:'muted'},'Siap menerima')));
  });
  tv.append(nowBox);
  var next=el('div',{class:'next'},el('h2',{style:'margin-top:0'},'Giliran berikutnya')),lst=el('div',{class:'list'});
  if(!waiting.length)lst.append(el('div',{class:'empty'},'Tidak ada antrean. Silakan langsung duduk.'));
  waiting.slice(0,6).forEach(function(it){var e=sim.est[it.id];
    lst.append(el('div',{class:'item'},el('div',{class:'code'},it.code),el('div',{class:'main'},el('b',null,firstName(it.name)),
      it.type==='booking'?el('span',{class:'chip book'},'Booking '+hm(it.slot)):null),el('div',{class:'muted'},e?'sekitar '+hm(e.start):'')));
  });
  next.append(lst);tv.append(next);
  tv.append(el('div',{class:'foot'},cfg.wa?'Booking dan antrean lewat WhatsApp: '+cfg.wa:'Tanya kasir untuk booking jam berikutnya.'));
  v.replaceChildren(tv);
}

/* ---------- setelan ---------- */
function fillCfg(force){
  var f=$('#cfgForm');if(f.dataset.dirty&&!force)return;
  $('#sShop').value=cfg.shop;$('#sOpen').value=cfg.open;$('#sClose').value=cfg.close;$('#sWa').value=cfg.wa||'';
  cfg.barbers.forEach(function(b,i){var x=$('#sB'+(i+1));if(x)x.value=b.name});
  $('#sPrice1').value=cfg.services.biasa.price;$('#sMin1').value=cfg.services.biasa.min;
  $('#sPrice2').value=cfg.services.keramas.price;$('#sMin2').value=cfg.services.keramas.min;
  $('#sSlot').value=String(cfg.slotMin);$('#sPeakStart').value=cfg.peakStart;$('#sPeakEnd').value=cfg.peakEnd;$('#sShare').value=cfg.walkinShare;
}
function renderCalc(){
  var lost=Math.max(0,+$('#cLost').value||0),days=Math.max(1,+$('#cDays').value||1);
  var avg=(cfg.services.biasa.price+cfg.services.keramas.price)/2;
  var box=$('#calc');box.replaceChildren(
    el('div',null,el('div',{class:'small muted'},'Per hari'),el('div',{class:'v'},rp(lost*avg))),
    el('div',null,el('div',{class:'small muted'},'Per bulan'),el('div',{class:'v'},rp(lost*avg*days))),
    el('div',null,el('div',{class:'small muted'},'Harga rata-rata'),el('div',{class:'v'},rp(avg))));
}
function saveCfg(e){
  e.preventDefault();
  var n=clone(cfg);
  n.shop=$('#sShop').value.trim()||DEFAULT_CFG.shop;n.open=$('#sOpen').value||'10:00';n.close=$('#sClose').value||'20:00';n.wa=$('#sWa').value.trim();
  n.barbers=cfg.barbers.map(function(b,i){var x=$('#sB'+(i+1));return {id:b.id,name:(x&&x.value.trim())||b.name}});
  n.services.biasa.price=Math.max(0,+$('#sPrice1').value||0);n.services.biasa.min=Math.max(5,+$('#sMin1').value||20);
  n.services.keramas.price=Math.max(0,+$('#sPrice2').value||0);n.services.keramas.min=Math.max(5,+$('#sMin2').value||30);
  n.slotMin=+$('#sSlot').value||30;n.peakStart=$('#sPeakStart').value||'14:00';n.peakEnd=$('#sPeakEnd').value||'16:00';
  n.walkinShare=Math.min(90,Math.max(0,+$('#sShare').value||0));
  write(function(){return db.doc('config/main').set(n)}).then(function(){
    if(db){cfg=n;delete $('#cfgForm').dataset.dirty;applyCfg();render();toast('Setelan tersimpan')}});
}

/* ---------- form kasir & booking ---------- */
function fillSelects(){
  [['#wService','#bService'],['#wBarber','#bBarber']].forEach(function(pair,idx){
    pair.forEach(function(sid){
      var s=$(sid),v=s.value,opts=[];
      if(idx===0)Object.keys(cfg.services).forEach(function(k){opts.push([k,cfg.services[k].label+' · '+rp(cfg.services[k].price)])});
      else{opts.push(['any','Siapa saja (tercepat)']);cfg.barbers.forEach(function(b){opts.push([b.id,b.name])})}
      s.replaceChildren.apply(s,opts.map(function(o){return el('option',{value:o[0]},o[1])}));
      if(v&&opts.some(function(o){return o[0]===v}))s.value=v;
    });
  });
}
function applyCfg(){
  $('#shopName').textContent=cfg.shop;document.title=cfg.shop+' · Antrean';
  fillSelects();fillCfg(false);renderCalc();
}
function addWalkin(e){
  e.preventDefault();
  var name=$('#wName').value.trim();if(!name){toast('Isi nama pelanggan dulu');$('#wName').focus();return}
  var date=todayStr(),num=nextNum('walkin',date);
  var data={date:date,type:'walkin',name:name,phone:$('#wPhone').value.trim(),service:$('#wService').value,barber:$('#wBarber').value,
    slot:null,createdAt:Date.now(),status:'waiting',num:num,code:'A'+pad(num)};
  var btn=$('#wSubmit');btn.disabled=true;
  write(function(){var ref=db.collection('queue').doc();lastWalkin=ref.id;return ref.set(data)}).then(function(){
    $('#wName').value='';$('#wPhone').value='';btn.disabled=readOnly;render()});
}
function addBooking(e){
  e.preventDefault();
  var name=$('#bName').value.trim();
  if(!name){toast('Isi nama pelanggan dulu');$('#bName').focus();return}
  if(!sel.slot){toast('Pilih jam booking dulu');return}
  var date=$('#bDate').value,num=nextNum('booking',date);
  var data={date:date,type:'booking',name:name,phone:$('#bPhone').value.trim(),service:$('#bService').value,barber:$('#bBarber').value,
    slot:sel.slot,createdAt:Date.now(),status:'waiting',num:num,code:'B'+pad(num)};
  var btn=$('#bSubmit');btn.disabled=true;
  write(function(){var ref=db.collection('queue').doc();lastBooking=ref.id;return ref.set(data)}).then(function(){
    $('#bName').value='';$('#bPhone').value='';sel.slot=null;btn.disabled=readOnly;render()});
}
function fillDates(){
  var s=$('#bDate'),v=s.value,t=Date.now(),opts=[];
  [0,1,2].forEach(function(d){var ms=t+d*86400000;opts.push([dateStr(ms),(d===0?'Hari ini':d===1?'Besok':'Lusa')+', '+dayLabel(dateStr(ms))])});
  s.replaceChildren.apply(s,opts.map(function(o){return el('option',{value:o[0]},o[1])}));
  if(v&&opts.some(function(o){return o[0]===v}))s.value=v;
}

/* ---------- routing, notice, loop ---------- */
function setNote(k,t){notes[k]=t;var n=$('#notice');n.replaceChildren();[notes.ro,notes.net].forEach(function(x){if(x)n.append(el('div',{class:'notice'},x))})}
function currentView(){var v=location.hash.slice(1);return VIEWS.indexOf(v)>-1?v:'kasir'}
function render(){
  var v=currentView();
  VIEWS.forEach(function(x){$('#v-'+x).hidden=x!==v});
  document.querySelectorAll('#tabs a').forEach(function(a){if(a.dataset.v===v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  var d=new Date();$('#clock').textContent=d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'})+' · '+hm(d.getTime());
  if(v==='kasir')renderKasir();else if(v==='booking')renderBooking();else if(v==='layar')renderLayar();
}
function setReadOnly(){
  ['#wSubmit','#bSubmit','#cfgSave'].forEach(function(s){$(s).disabled=readOnly});
  setNote('ro',readOnly?'Akun ini hanya bisa melihat. Untuk mengubah antrean, minta akses Contributor atau Editor.':'');
}

async function boot(){
  var c=window.claude;
  if(!c||!c.use){setNote('net','Penyimpanan belum tersambung. Halaman ini baru menampilkan tampilan kosong.');return}
  try{db=await c.use('db');user=await c.use('user')}catch(e){db=null}
  if(!db){setNote('net','Penyimpanan belum tersambung. Masuk ke akun Claude untuk memakai antrean ini.');return}
  try{if(user){var w=await user.can('data.write');if(w===false){readOnly=true;setReadOnly()}}}catch(e){}
  var timer=setTimeout(function(){setNote('net','Data antrean belum bisa dijangkau. Tampilan mungkin belum terbaru.')},10000);
  db.doc('config/main').onSnapshot(function(s){
    cfg=s.exists?mergeCfg(s.data()):clone(DEFAULT_CFG);cfgLoaded=true;applyCfg();render();
  },function(){});
  db.collection('queue').where('date','>=',todayStr()).onSnapshot(function(snap){
    items=snap.docs.map(function(d){var o=Object.assign({},d.data());o.id=d.id;return o});
    if(!snap.metadata.fromCache){clearTimeout(timer);setNote('net','')}
    render();
  },function(e){clearTimeout(timer);setNote('net','Data antrean tidak bisa dibaca ('+((e&&e.code)||'error')+').')});
}

$('#walkinForm').addEventListener('submit',addWalkin);
$('#bookForm').addEventListener('submit',addBooking);
$('#cfgForm').addEventListener('submit',saveCfg);
$('#cfgForm').addEventListener('input',function(){this.dataset.dirty='1'});
$('#bDate').addEventListener('change',function(){sel.slot=null;renderBooking()});
$('#bBarber').addEventListener('change',renderBooking);
['#cLost','#cDays'].forEach(function(s){$(s).addEventListener('input',renderCalc)});
window.addEventListener('hashchange',render);
var root=document.documentElement;
function effTheme(){return root.getAttribute('data-theme')||(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}
function paintTheme(){$('#themeBtn').textContent=effTheme()==='dark'?'Mode terang':'Mode gelap'}
try{var saved=localStorage.getItem('theme');if(saved==='dark'||saved==='light')root.setAttribute('data-theme',saved)}catch(e){}
$('#themeBtn').addEventListener('click',function(){var n=effTheme()==='dark'?'light':'dark';root.setAttribute('data-theme',n);try{localStorage.setItem('theme',n)}catch(e){}paintTheme()});
if(window.matchMedia)matchMedia('(prefers-color-scheme: dark)').addEventListener('change',paintTheme);
paintTheme();
fillDates();applyCfg();render();
setInterval(render,20000);
boot();
})();
