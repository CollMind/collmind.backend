#!/usr/bin/env python3
"""
T-283 · rota → hücre eşlemesi, YENİDEN TÜRETİLEBİLİR.

Çıktı: <dosya>\t<YÖNTEM>\t<yol>\t<@Roles>\t<hücre>\t<kaynak>
Anahtar (ilk üç sütun) route-scope.awk ve kapsam baseline'larıyla AYNI.

kaynak sütunu:
  MEKANIK      aile(dizin) + fiil(HTTP yöntemi) — tümüyle türetilmiş
  Z20          USER_READ silindi → USER_MANAGE
  Z31/Z32      SUMMARY_READ — tanım: nesne-bağsız + çok-işlem-modüllü portföy özeti
  Z35          MODES_SUBMIT — gönderim/iptal/taslak, onay kararı DEĞİL
  YARGI        mekanik kural yetmiyor; gerekçe EK belgesinde

KULLANIM:  python3 scripts/analysis/route-cell-map.py   (repo kökünden: collmind.backend)
"""
import io, re, glob, subprocess, sys, os

FAM = {'modes':'MODES','shared':'SHARED','master-data':'MASTER_DATA','customer':'CUSTOMER',
       'user':'USER','tenant':'TENANT','admin':'ADMIN','notification':'NOTIFICATION'}

# --- Z31/Z32: SUMMARY_READ üyeleri (tanımdan, kayıtlı) ---
SUMMARY = {
 'finance-reporting/budget-utilization','finance-reporting/spend-trend',
 'finance-reporting/budget-at-risk','finance-reporting/cash-flow-projection',
 'finance-reporting/mechanic-effectiveness','finance-reporting/plan-performance',
 'finance-reporting/spend-composition','finance-reporting/variance-analysis',
 'agreement-transactions/stats/summary','actuals-first/sales-actuals/summary',
 'dashboard/summary','actuals-first/settlements/summary',
}
# --- Z35: MODES_SUBMIT — gönderim/iptal/taslak ---
SUBMIT_RE = re.compile(r'/(submit|cancel)(-[a-z-]+)?(/|$)|/return-to-draft(/|$)')
# --- MODES_APPROVE: ONAY-AKISI DURUM GECISI (UYE LISTESI, desen DEGIL) ---
# Sinif yol deseninden degil DAVRANISTAN tanimlanir. Olculdu 2026-08-24: alti
# uyenin hepsi onay DURUMU yazar (updateStatusCas -> status/approved*/rejected*/
# escalated*/pendingFinanceReview); plan-ICERIK kolonu SIFIR.
#   POZ.KONTROL  plan.service.updateSkuVolume: baseVolume/plannedVolume YAZAR,
#                status'u yalniz OKUR (DRAFT guard) -> ters yonlu, ayirt edici.
# Eski hali bir yol deseniydi (approve|reject|approval-decision) ve
# plans/:id/review + plans/:id/escalate-to-finance'i KACIRIYORDU: mekanik
# POST->WRITE kuralina dusuyorlardi. Ikisi de capabilities.ts:432'de (Z30 H2)
# ZATEN onay ailesinde sayiliydi -- mekanik kural, kayitla celistiginde kaybeder.
# 'approval-decision' dusuruldu: SIFIR rota esliyordu (olu desen, olculdu).
APPROVE = {
 'agreements/:id/approve', 'agreements/:id/reject',
 'plans/:id/approve', 'plans/:id/reject',
 'plans/:id/review', 'plans/:id/escalate-to-finance',
}

# --- Z35: MODES_WRITE bölünmesi — ÜYELİK ALT-MODÜLDEN (davranış) ---
# ⛔ @Roles'tan TÜRETİLMEZ: hücre, yönettiği şeyden türetilirse harita bir
# TOTOLOJİ olur (dairesel evren). Ayırt edici işin cinsi:
#   gerçekleşme/alım girişi -> defter-etkili ya da fiili veri alımı
#   plan/anlaşma tanımı     -> planlama artefaktı, defter etkisi YOK
# Teyit (Z35): modes/ içinde ledgerService çağıranlar agreement-transaction ve
# on-invoice — ikisi de ACTUALS tarafında; PLAN tarafında SIFIR defter çağrısı.
ACTUALS_SUBMODULES = ('agreement-transaction', 'on-invoice', 'sales-actuals')
PLAN_SUBMODULES    = ('agreement', 'plan')

def modes_write_cell(f):
    """Eşleşme TAM SEGMENT EŞİTLİĞİDİR ('part in TUPLE'), ön-ek/substring DEĞİL.

    Koruyan şey budur, döngü SIRASI değil: 'agreement-transaction' dizini
    PLAN_SUBMODULES'ün hiçbir üyesine EŞİT olmadığı için ön-ek çakışması
    yapısal olarak imkânsız (ölçüldü: iki döngü takas edildi, çıktı BİREBİR aynı).
    ⚠️ startswith/substring eşleşmesine geçilirse bu garanti KAYBOLUR ve sıra
    aniden yük taşımaya başlar — o gün bu docstring de değişmeli.
    """
    seg = f.replace('src/modules/modes/','').split('/')
    for part in seg:
        if part in ACTUALS_SUBMODULES: return 'MODES_ACTUALS_WRITE'
    for part in seg:
        if part in PLAN_SUBMODULES:    return 'MODES_PLAN_WRITE'
    return None

cache={}
def src(f):
    if f not in cache: cache[f]=io.open(f,encoding='utf-8').read()
    return cache[f]
def lines(f): return src(f).splitlines()

ALLSRC = sorted(glob.glob('src/**/*.ts', recursive=True))
BODY={}
def const_body(n):
    if n in BODY: return BODY[n]
    pat=re.compile(r'const\s+'+re.escape(n)+r'\s*(?::[^=]*)?=\s*\[(.*?)\]',re.S)
    b=None
    for g in ALLSRC:
        m=pat.search(src(g))
        if m: b=m.group(1); break
    BODY[n]=b; return b
def resolve(n, seen=None):
    """FIXPOINT — iç içe spread sabiti (READ_ROLES=[...WRITE_ROLES,…]) özyinelemeli."""
    seen = seen or set()
    if n in seen: return set()
    seen.add(n)
    b=const_body(n)
    if b is None: return set()
    got=set(re.findall(r'UserRole\.([A-Z_]+)',b))
    for sp in re.findall(r'\.\.\.([A-Za-z_][\w]*)',b): got |= resolve(sp,seen)
    return got

def code(s): return not (s.startswith('//') or s.startswith('*') or s.startswith('/*'))
def grab(L,i):
    blk=L[i].strip(); j=i
    while blk.count('(')>blk.count(')') and j+1<len(L): j+=1; blk+=' '+L[j].strip()
    return blk

def roles_for(f, ln):
    """@Roles HTTP dekoratörünün ÜSTÜNDE de ALTINDA da olabilir — iki yön de taranır."""
    L=lines(f); blk=''
    i=ln-1
    while i<len(L):
        s=L[i].strip()
        if not code(s): i+=1; continue
        if s.startswith('@Roles('): blk=grab(L,i); break
        if re.match(r'^(public |private |protected )?(async )?[a-zA-Z_$][\w$]*\s*\(',s) and not s.startswith('@'): break
        i+=1
    if not blk:
        for k in range(ln-2,-1,-1):
            s=L[k].strip()
            # N3 (W3 review): YORUM FİLTRESİ — ileri tarama `code(s)` uyguluyordu,
            # geri tarama UYGULAMIYORDU. Bugün etkisiz (9 yorum satırının 9'u da
            # // ya da * ile başlıyor) AMA bu dalga controller'lara `@Roles(`
            # İÇEREN YORUM EKLİYOR, ve yorum kirliliği bu repoda ÖLÇÜLMÜŞ,
            # iki yönde birden yanıltan bir sınıf.
            if not code(s): continue
            if s.startswith('@Roles('): blk=grab(L,k); break
            if s.endswith('}') and not s.startswith('@'): break
    # ⛔ DOSYA-GENELİ GERİ DÜŞÜŞ KALDIRILDI (W3, 2026-08-25).
    # Eski hali dosyanın BAŞINDAN ilk @Roles'u alıp bu rotaya ATFEDİYORDU.
    # Göçen bir rotanın @Roles'u YOKTUR; ama aynı dosyada göçMEMİŞ bir kardeş
    # varsa onun kümesi göçenlere UYDURULUYORDU. W1/W2'de görünmedi çünkü o
    # controller'larda @Roles hiç kalmamıştı; W3 KARMA (GET /users bilinçli
    # olarak göçmedi) ve kusur ORADA ortaya çıktı — her kısmi dalgada tekrarlar.
    # Kanonik bir üreticinin veri UYDURMASI. ⚠️ DÜZELTME (W3 review): sayı
    # SEKİZ değil YEDİ — POST /users dosyadaki ilk @Roles'tan ÖNCE geldiği için
    # '?' üretiyordu, uydurma değil. Ve geçmiş zaman da yanlıştı: hiçbir
    # COMMIT'Lİ TSV sürümü uydurma değer taşımadı (dört sürüm tarandı) —
    # düzeltilmeseydi ÜRETECEKTİ.
    if not blk: return '?'
    got=set(re.findall(r'UserRole\.([A-Z_]+)',blk))
    for sp in re.findall(r'\.\.\.([A-Za-z_][\w]*)',blk): got |= resolve(sp)
    return ','.join(sorted(got)) if got else '?'

CAPS_TS = 'src/common/authorization/capabilities.ts'

def role_caps_inverse():
    """ROLE_CAPABILITIES'i tersine cevir: hucre -> o hucreyi ALAN roller.

    KANONIK KAYNAK capabilities.ts'tir; bu fonksiyon onu OKUR, kopyalamaz.
    Yorum ayiklamasi IKI YAZIMLA SINIRLI: satir-sonu `//` ve `*`/`/*` ile
    BASLAYAN tam satirlar. Blok yorumu (`/* ... */`) satir ORTASINDA ya da
    coklu satirda gorulurse AYIKLANMAZ ve hayalet rol uretebilir — bu yuzden
    boyle bir yazim gorulurse SESSIZ AYIKLAMA YERINE ACIK HATA verilir
    (olculdu 2026-08-25, code-reviewer S5: `/*` blokta bugun 0 kez geciyor,
    `//` 24 kez — poz.kontrol).

    `CLAUDE.md`: YORUM KIRLILIGI iki yonde birden yaniltir, ve
    ROLE_CAPABILITIES bloklari yorum acisindan yogun.
    """
    txt = src(CAPS_TS)
    m = re.search(r'export const ROLE_CAPABILITIES[^=]*=\s*\{(.*?)\n\};', txt, re.S)
    if m is None: return {}
    body = m.group(1)
    if '/*' in body:
        raise SystemExit(
            'route-cell-map: ROLE_CAPABILITIES blokunda BLOK YORUMU (/*) var. '
            'Ayiklayici yalnız // ve satir-basi * yazimlarini kapsiyor; sessizce '
            'yanlis ayiklamak yerine DURULDU. Ayiklayiciyi genislet ya da blok '
            'yorumunu // yazimina cevir.')
    # yorum ayikla (satir sonu // ve tam satir *) — POZ.KONTROL asagida
    clean = '\n'.join(
        re.sub(r'//.*$', '', ln) for ln in body.splitlines()
        if not ln.strip().startswith(('*', '/*'))
    )
    inv = {}
    for rm in re.finditer(r'\[UserRole\.([A-Z_]+)\]\s*:\s*\[(.*?)\]', clean, re.S):
        role, caps = rm.group(1), rm.group(2)
        for cm in re.finditer(r'CAPABILITIES\.([A-Z_]+)', caps):
            inv.setdefault(cm.group(1), set()).add(role)
    return inv

def cell_for(f, meth, path):
    d = re.sub(r'^src/modules/','',f).split('/')[0]
    fam = FAM.get(d,'?')
    if path in SUMMARY:            return 'SUMMARY_READ','Z31/Z32'
    if path in APPROVE:            return 'MODES_APPROVE','YARGI'
    if fam=='MODES' and SUBMIT_RE.search('/'+path):  return 'MODES_SUBMIT','Z35'
    verb = 'READ' if meth=='GET' else 'WRITE'
    if fam=='USER' and verb=='READ':                 return 'USER_MANAGE','Z20'
    if fam=='MODES' and verb=='WRITE':
        c = modes_write_cell(f)
        if c: return c,'Z35'
        # ⛔ SENTINEL '?' TAŞIMAK ZORUNDA. Önceki hâli 'MODES_WRITE_COZULEMEDI'ydi ve
        # yorumu "G1 kapısına düşer" diyordu — ÖLÇÜLDÜ (2026-08-24, code-reviewer B1):
        # G1'in üç koşulunun ÜÇÜ DE False (dize boş değil, içinde '?' yok, kaynak
        # boş değil) => kapı ATEŞLEMİYORDU, yani FAIL-OPEN. Alt-modül listeleri ELLE
        # yazılı ve tam-segment eşleşiyor; bir dizin yeniden adlandırılırsa (ör.
        # sales-actuals -> sales-actuals-import) rotalar hayalet hücreye düşer,
        # G5 onları saymaz ve tur YEŞİL kalır. Bu dal bugün 0 rota koşuyor.
        return 'MODES_WRITE_?','?'
    return f'{fam}_{verb}','MEKANIK'

def reconcile(rows):
    """MUTABAKAT — exit 2 ile durduran bir kapi.

    ⚠️ KAPSAM: bu dosya scripts/analysis/ altinda ve `run-all.sh`/`npm run guards`
    KAPSAMAZ (olculdu 2026-08-24). Yani operatorun ELLE kosturdugu bir kapidir;
    `npm run guards` yesilken bu mutabakat HIC KOSMAMIS olabilir.

    ELLE YAZILMIS SAYI YOK: kanonik kaynak UYE LISTESIDIR. Bir sayiyi burada
    sabitlemek, bir sonraki rota eklendiginde yalan soylerdi -- "liste, sayi
    degil" kuralinin script tarafi.

    G1 ic mutabakat      kategori toplamlari == satir sayisi
                         (EK 3 §1'in 190+12+5+2+4=213 != 211 tutarsizligini
                          yakalayan sey elle toplamaydi; artik tur kendi yakalar)
    G2 enumerasyon       bildirilen her uye TAM BIR rotaya dusmeli
                         (olu uye = bayat liste · cift uye = kopya)
    G3 ayristirma        cozulemeyen @Roles ('?') olmamali
    W1 tuhaflik          ADMIN tasimayan rota -- UYARI, kapi DEGIL (Z29: bir
                         kapi, olcumun BASARISINI hata sayamaz; boyle bir rota
                         bir gun mesru olabilir)
    """
    from collections import Counter
    err=[]; out=sys.stderr
    cells=Counter(r[4] for r in rows); srcs=Counter(r[5] for r in rows)
    n=len(rows)

    print('=== MUTABAKAT ===', file=out)
    kind=Counter(r[6] for r in rows)
    print(f'-- kapsam --  ROLES={kind.get("ROLES",0)}  CAP={kind.get("CAP",0)}  '
          f'toplam={len(rows)}', file=out)
    print('-- hucre --', file=out)
    for k,v in sorted(cells.items(), key=lambda x:-x[1]): print(f'   {k:<22}{v}', file=out)
    print('-- kaynak --', file=out)
    for k,v in sorted(srcs.items(), key=lambda x:-x[1]): print(f'   {k:<22}{v}', file=out)

    # G1 — anahtar tekilligi + bos alan.
    # DIKKAT: "kategori toplami == satir sayisi" kontrolu BILEREK YOK. Counter
    # satirlarin kendisinden turetilir, yani o esitlik TANIM GEREGI saglanir ve
    # kontrol hicbir girdide kirmiziya donemez (olculdu 2026-08-24, mutasyon B:
    # sahte satir eklendi -> 212=212=212, kapi ates ETMEDI). Bir totoloji, yesil
    # oldugu icin CALISTIGI SANILAN kontroldur -- olmayan kapidan kotudur.
    # Yerine KIRMIZIYA DONEBILEN iki kontrol:
    keys=Counter((r[0],r[1],r[2]) for r in rows)
    dupk=sorted(k for k,v in keys.items() if v>1)
    print(f'G1 anahtar tekilligi cift={len(dupk)}', file=out)
    for k in dupk: err.append(f'G1 CIFT ANAHTAR: {k[0]} {k[1]} {k[2]}')
    blank=[r for r in rows if not r[4] or not r[5] or '?' in r[4]]
    print(f'G1 bos/gecersiz hucre {len(blank)}', file=out)
    for r in blank: err.append(f'G1 BOS/GECERSIZ hucre: {r[0]} {r[1]} {r[2]} -> {r[4]!r}')

    # G4 — CAPRAZ-ARAC mutabakati: kanonik ayristiricinin ROLES kovasi ile
    # satir sayisi ayni olmali. Bagimsiz bir yoldan gelir, yani KIRILABILIR.
    try:
        rs=subprocess.run(['bash','scripts/guards/route-scope.sh','--list'],
                          capture_output=True,text=True)
        m=re.search(r'ROLES:\s*(\d+)', rs.stdout)
        mc=re.search(r'CAPABILITY[^:]*:\s*(\d+)', rs.stdout)
        if not m or not mc:
            err.append('G4 route-scope.sh ROLES/CAPABILITY satiri OKUNAMADI '
                       '(capraz kontrol YAPILAMADI)')
        else:
            roles=int(m.group(1)); caps=int(mc.group(1))
            # T-285: evren artik ROLES + CAPABILITY. Gocen rota ROLES kovasindan
            # CAPABILITY kovasina TASINIR, yani toplam SABIT kalir — ve bu
            # toplamin sabitligi gocun kayipsizliginin capraz kanitidir.
            print(f'G4 capraz-arac  route-scope ROLES={roles} + CAP={caps} '
                  f'= {roles+caps}  satir={n}', file=out)
            if roles+caps != n:
                err.append(f'G4 CAPRAZ FARK: route-scope ROLES+CAP={roles+caps} '
                           f'!= satir {n}')
    except Exception as e:
        err.append(f'G4 capraz kontrol KOSMADI: {e}')

    # G2 — bildirilen uye listeleri gercege dusuyor mu
    paths=Counter(r[2] for r in rows)
    for name,decl in (('SUMMARY',SUMMARY),('APPROVE',APPROVE)):
        dead=sorted(m for m in decl if paths.get(m,0)==0)
        dup =sorted(m for m in decl if paths.get(m,0)>1)
        print(f'G2 {name:<8} bildirilen={len(decl)} olu={len(dead)} cift={len(dup)}', file=out)
        for m in dead: err.append(f'G2 {name} OLU UYE (hicbir rotaya dusmuyor): {m}')
        for m in dup:  err.append(f'G2 {name} CIFT UYE: {m}')

    # G3
    # T-285: EVREN yalnız ROLES-türü satırlar. Göçen rotanın @Roles'u YOKTUR
    # ve olmamalıdır (rota basina TEK mekanizma) — onu "cozulemedi" saymak,
    # BASARIYI hata saymak olurdu (Z29). Gocen rotanin karsiligi G6'dir.
    unresolved=[r for r in rows if r[6]=='ROLES' and r[3]=='?']
    print(f'G3 cozulemeyen @Roles {len(unresolved)}  (evren: ROLES-turu satirlar)', file=out)
    for r in unresolved: err.append(f'G3 @Roles cozulemedi: {r[0]} {r[1]} {r[2]}')

    # G5 — Z35 bölünmesinin BAĞIMSIZ teyidi.
    # Üyelik ALT-MODÜLDEN geldi; burada @Roles ile ÇAKIŞTIRILIYOR. İki ayrı
    # yol aynı yere çıkmalı — çıkmıyorsa bu bir BULGUDUR, sessizce geçilmez.
    # (Bu bir tanım DEĞİL bir kontroldür: üyelik @Roles'tan türetilseydi
    #  kontrol totoloji olurdu.)
    # ✅ EXPECT ARTIK ELLE YAZILMIYOR — canli haritadan (ROLE_CAPABILITIES)
    # TURETILIYOR (B3 Dalga-M kabul sartı 1). Onceki hali ikinci bir dogruluk
    # kaynagiydi ve harita CANLI koda dondugu an bir Ilke-4 cifti olurdu.
    # Cift DOGMADAN oldu: tek kaynak capabilities.ts.
    EXPECT={c: role_caps_inverse().get(c, set())
            for c in ('MODES_ACTUALS_WRITE','MODES_PLAN_WRITE')}
    for c, r in EXPECT.items():
        print(f'G5 EXPECT[{c}] = {sorted(r) or "BOS"}  (kaynak: ROLE_CAPABILITIES)', file=out)
        if not r:
            err.append(f'G5 EXPECT BOS: {c} hicbir role verilmemis — harita okunamadi mi?')
    mism=[]
    for r in rows:
        if r[4] in EXPECT:
            got=set(r[3].split(',')) if r[3]!='?' else set()
            if got!=EXPECT[r[4]]: mism.append((r[4],r[1],r[2],r[3]))
    n_split=sum(1 for r in rows if r[4] in EXPECT)
    print(f'G5 Z35 bolunmesi   uye={n_split}  @Roles uyusmazligi={len(mism)}', file=out)
    for c,m,pth,rl in mism:
        err.append(f'G5 UYUSMAZLIK: {m} {pth} hucre={c} @Roles={rl}')

    # ── G6 (T-285) — GÖÇ DOĞRU HÜCREYE VARDI MI.
    # Göçen rotanın BEYAN ETTİĞİ yetenek (@RequireCapability argümanı, awk 10.
    # sütun) ile MEKANİK TÜRETİMİN verdiği hücre çakıştırılır. İki BAĞIMSIZ yol:
    # beyan controller dosyasında, türetim alt-modül+fiil kuralında. Ayrışırsa
    # göç yanlış hücreye varmış demektir ve bugün bunu HİÇBİR ŞEY görmüyordu.
    migrated=[r for r in rows if r[6]=='CAP']
    bad=[r for r in migrated if r[7] != r[4]]
    unresolved=[r for r in migrated if r[7]=='-']
    print(f'G6 goc mutabakati  gocen={len(migrated)}  '
          f'beyan!=turetim={len(bad)}  cozulemeyen beyan={len(unresolved)}', file=out)
    for r in bad:
        err.append(f'G6 GOC YANLIS HUCREYE: {r[1]} {r[2]} '
                   f'beyan={r[7]} turetim={r[4]} ({r[0]})')
    for r in unresolved:
        err.append(f'G6 BEYAN COZULEMEDI: {r[1]} {r[2]} ({r[0]}) — '
                   f'@RequireCapability argumani CAPABILITIES.X yaziminda degil')

    # W1 — uyari, kapi degil
    # S1 (W3 review): EVREN G3 ile AYNI daraltmayı alır — göçen rotanın
    # @Roles'u '-' olduğu için hepsi "ADMIN taşımıyor" görünüyordu (bugün 19,
    # W8 sonunda 211 olacaktı). "Sinyal SABİTSE, sinyal DEĞİLDİR."
    # Bu dedektörün kayıtlı bir yakalama sicili var (fixpoint kusurunu O buldu,
    # EK 3 §1) ve pozitif kontrolü "beklenen 0" diyor — evren daraltılmazsa
    # o beklenti kalıcı olarak yalan söylerdi.
    noadmin=[r for r in rows if r[6]=='ROLES' and 'ADMIN' not in r[3].split(',')]
    print(f'W1 (uyari) ADMIN tasimayan rota {len(noadmin)}  (evren: ROLES-turu)', file=out)
    for r in noadmin: print(f'   ? {r[1]} {r[2]} [{r[3]}]', file=out)

    if err:
        print('\n-- MUTABAKAT BASARISIZ --', file=out)
        for e in err: print(f'   {e}', file=out)
        return 2
    print('-- MUTABAKAT TAMAM --', file=out)
    return 0

def main():
    awk='scripts/guards/route-scope.awk'
    files=sorted(glob.glob('src/**/*.controller.ts',recursive=True))
    out=subprocess.run(['awk','-f',awk]+files,capture_output=True,text=True).stdout
    rows=[]; err_two_mech=[]
    for line in out.splitlines():
        c=line.split('\t')
        if len(c)<9: continue
        has_roles = c[4]=='1'
        has_cap   = c[8]=='1'
        # T-285: GÖÇEN ROTALAR ARTIK DÜŞMÜYOR. Önceki hali yalnız `c[4]=='1'`
        # (yani @Roles) alıyordu; W1'in üç rotası haritadan SESSİZCE düşmüştü ve
        # hiçbir kapı bunu görmüyordu. Sonuç: göç ilerledikçe G5'in KAPSAMI
        # eriyecekti — 211->0 yolunda son rota göçtüğünde G5 hiçbir şey ölçmez.
        # Z29'un "kapı, ölçümün BAŞARISINI hata sayamaz" tuzağının TERS hâli:
        # kapı, başarı ilerledikçe sessizce BOŞALIYOR.
        if not (has_roles or has_cap): continue
        f,ln,meth,path = c[0],int(c[1]),c[2],c[3]
        cell,srcn = cell_for(f,meth,path)
        declared = c[9] if len(c)>9 else '-'
        roles = roles_for(f,ln)
        # Göçen rotada @Roles YOKTUR — bu bir ÇÖZÜLEMEME değil, bir YOKLUK.
        # '?' = "@Roles VAR ama ayrıştırılamadı" (KUSUR, G3'ün konusu)
        # '-' = "@Roles YOK" (BEKLENEN, göç sonrası)
        # ⛔ S2 (W3 review): koşul `has_roles`'a bağlanır, roles_for'un SONUCUNA
        # değil. Elde ayırt edici (awk c[4]) VARKEN onu kullanmamak, "@Roles
        # taşıyan ama ayrıştırılamayan bir göçmüş rota"yı SESSİZCE '-' (yok)
        # diye raporlardı — bu commit'in kapattığı "üretici veri uyduruyor"
        # sınıfının KALAN YARISI.
        if has_cap and not has_roles and roles == '?': roles = '-'
        if has_cap and has_roles:
            # §2.5: iki mekanizma aynı rotada — sessizce sınıflandırılmaz.
            # single-mechanism.sh bunu exit 3 ile durduruyor; buraya ulaşması
            # o kapının atlandığı anlamına gelir.
            err_two_mech.append(f'{meth} {path} ({f})')
        rows.append([f,meth,path,roles,cell,srcn,
                     'CAP' if has_cap else 'ROLES', declared])
    for r in rows: print('\t'.join(str(x) for x in r))
    if err_two_mech:
        print('⛔ İKİ MEKANİZMA aynı rotada (single-mechanism atlandı mı?):',
              file=sys.stderr)
        for x in err_two_mech: print('   ', x, file=sys.stderr)
        return 2
    print(f'# TOPLAM {len(rows)}', file=sys.stderr)
    return reconcile(rows)

if __name__=='__main__': sys.exit(main())
