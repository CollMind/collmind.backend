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
 'actuals-first/sales-actuals/summary','actuals-first/settlements/summary',
 # ⛔ `Z43 §2` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) —
 # `agreement-transactions/stats/summary` DÜŞTÜ: bir AD-BENZERLİĞİ
 # DOSYALAMASIYDI, davranışı `MODES_LEDGER_READ`'in tam profili
 # (bkz. `MODES_LEDGER_READ_ROUTES`).
 # ⛔ `Z43 §1` (aynı dalga) — `dashboard/summary` DÜŞTÜ: kapsam-çözümlü
 # (`resolveScopedCplIds`), `SUMMARY_READ`'in (nesne-bağsız ∧
 # çok-işlem-modüllü) tanımının DIŞINDA. `MODES_READ` tabanına BİREBİR
 # transfer (bkz. `MODES_READ_CROSS_ROUTES`).
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

# --- Z37 §3 (B3 kaza-dalgası K4 Parça 1, 2026-08-26): APPROVAL_QUEUE_READ —
# SHARED_READ'in dört istisnasından ikisi göçtü. Genel fam+verb kuralı
# (SHARED_READ) bunu YAKALAMAZ — ayırt edici genel "shared/ altında GET"
# değil, ONAY KUYRUĞU GÖRÜNÜRLÜĞÜ (K-2.6.4'ün onaycı yüzeyi). Üyelik
# `capabilities.ts`'in ROLE_CAPABILITIES'inde `{ADMIN,CATEGORY_MANAGER,
# FINANCE,READONLY}` (PLANNER bilinçli dışarıda — pin:
# test/approval-queue-read-boundary.e2e-spec.ts).
# ⛔ Z42 §4 (B3b-1 W9, 2026-08-26) — MODES_READ'in {A,CM,F,RO} natif kümesi
# (`agreements/pending-approvals` · `plans/approval-queue`) BURAYA eklendi —
# AYNI hücre, farklı modül (agreement/plan), birebir.
APPROVAL_QUEUE_READ_ROUTES = {
 ('GET', 'approvals'), ('GET', 'approvals/pending'),
 ('GET', 'agreements/pending-approvals'), ('GET', 'plans/approval-queue'),
}

# --- Z42 §4 (B3b-1 W9, 2026-08-26): MODES_READ'in yedi natif kümesinden
# ÜÇÜ YENİ hücrelere göçürüldü — genel fam+verb kuralı (MODES_READ) bunu
# YAKALAMAZ, hepsi `modes/` altında GET, mekanik olarak MODES_READ'e düşerdi.
# (meth,path) TAM eşleşmesi kullanılır (Z36 desenin AYNISI).
MODES_LEDGER_READ_ROUTES = {
 ('GET', 'agreement-transactions'), ('GET', 'agreement-transactions/:id'),
 ('GET', 'agreement-transactions/agreement/:agreementId'),
 ('GET', 'agreement-transactions/agreement/:agreementId/total'),
 ('GET', 'agreement-transactions/budget-impact/:agreementId'),
 ('GET', 'agreement-transactions/count'),
 ('GET', 'ledger'), ('GET', 'ledger/:id'),
 ('GET', 'ledger/agreement/:agreementId'),
 ('GET', 'ledger/agreement/:agreementId/consumed'),
 ('GET', 'ledger/envelope/:envelopeId'),
 ('GET', 'ledger/envelope/:envelopeId/consumed'),
 # ⛔ `Z43 §2/§6` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) — iki rota
 # BURAYA taşındı:
 #   stats/summary       — ad-benzerliği dosyalamasıydı, `SUMMARY`'den düştü.
 #   batch/:batchId       — `MODES_IMPORT_READ_ROUTES`'tan taşındı (`§6`
 #                          cümle-testi: `findAll`'un alt kümesi, açılım yok).
 ('GET', 'agreement-transactions/stats/summary'),
 ('GET', 'agreement-transactions/batch/:batchId'),
}
MODES_IMPORT_READ_ROUTES = {
 ('GET', 'agreement-transactions/template/csv'),
 ('GET', 'agreement-transactions/template/excel'),
 ('GET', 'on-invoice/template/csv'), ('GET', 'on-invoice/template/excel'),
}
# --- `Z43 §1` (`B3` istisna-dalgası `Faz-B`, 2026-08-27): `dashboard/summary`
# `MODES_READ` tabanına transfer edildi — ama dosyası `shared/dashboard/`
# altında (`FAM['shared']='SHARED'`), yani mekanik fam+verb kuralı onu
# `SHARED_READ`'e düşürürdü. Tıpkı `MODES_LEDGER_READ_ROUTES` gibi (meth,path)
# TAM eşleşmesiyle mekanik kuralın ÖNÜNE geçer.
MODES_READ_CROSS_ROUTES = {
 ('GET', 'dashboard/summary'),
}
MODES_ONINVOICE_READ_ROUTES = {
 ('GET', 'on-invoice/batch/:batchId'), ('GET', 'on-invoice/count'),
 ('GET', 'on-invoice/entries'),
}
# --- Z42 §5 (B3b-1 W9, 2026-08-26): TEK İŞLEV-AİLESİ hücresi — iki farklı
# modül (`modes/planning-first/plan` · `shared/spend-calculation`), aynı iş
# (plan bütçe kontrolü). Genel fam+verb kuralı ikisini de AYRI hücrelere
# (MODES_READ / SHARED_READ) düşürürdü.
BUDGET_CHECK_READ_ROUTES = {
 ('GET', 'plans/:id/budget-check'),
 ('GET', 'spend-calculation/validate-budget/:planId'),
}
# --- Z42 §5 (B3b-1 W9, 2026-08-26): formül-doğrulama çifti — yönetişim-okuma,
# mekanik POST→WRITE kuralına düşmeye devam ederdi (yazma yüzeyi ÖLÇÜLDÜ 0).
MASTER_DATA_GOVERNANCE_READ_ROUTES = {
 ('POST', 'master-data/kpis/validate-formula'),
 ('POST', 'master-data/mechanics/validate-formula'),
}
# --- `F12` düzeltme turu (ürün sahibi hükmü, 2026-09-02, `BL-2` kapanış
# paketi §2, `Z42` usulü): BASELINE_WRITE — baseline hacim upload'ı,
# GÖREV AYRILIĞI gerekçesiyle {ADMIN,FINANCE}. Genel fam+verb kuralı bunu
# YAKALAMAZ: dosyası `master-data/` altında POST, mekanik olarak
# MASTER_DATA_WRITE'a düşerdi — ve o hücre {ADMIN} kaldı (KPI/mekanik/SKU/
# CPL/tactic/brand/channel/category/FU yazma uçlarını taşıdığı için).
BASELINE_WRITE_ROUTES = {
 ('POST', 'master-data/baseline-volumes/upload'),
}

# --- Z36 (B3 W4b): SHARED_WRITE bölünmesi — ÜYELİK YOL+FİİL'DEN (davranış),
# genel fam+verb kuralından DEĞİL. Ayırt edici mekanik bir birleşim değil:
# YAZILAN NESNENİN SAHİPLİĞİ (`04_KARAR_KAYDI.md` Z36 §2). Genel
# `f'{fam}_{verb}'` kuralı bunu YAKALAYAMAZ — hepsi `shared/` altında POST,
# hepsi mekanik olarak SHARED_WRITE'a düşerdi. `(meth,path)` TAM eşleşmesi
# kullanılır (path-only eşleşme `POST /budget/envelopes` ile `GET
# /budget/envelopes`'ı AYIRAMAZDI — aynı yol, farklı fiil, farklı hücre).
SHARED_POLICY_WRITE_ROUTES = {
 ('PATCH', 'approval-policies/:id'),
}
SHARED_ENVELOPE_WRITE_ROUTES = {
 ('POST', 'budget/envelopes'), ('POST', 'budget/envelopes/:id/split'),
}
SHARED_SPEND_WRITE_ROUTES = {
 ('POST', 'spend-calculation/distribute/:planFuId/:mechanicId'),
 ('POST', 'spend-calculation/recalculate-on-volume-change/:skuId'),
}
# --- Z36 §5: hesap-okuma üçlüsü — POST ama yazma yüzeyi ÖLÇÜLDÜ 0
# (cascade yapısal olarak imkânsız), SHARED_READ'e gider. `POST` olması
# tek başına bir mutasyon işareti DEĞİL — genel verb kuralının aksine.
SHARED_CALC_READ_ROUTES = {
 ('POST', 'lta-agreements/context/rates'),
 ('POST', 'lta-agreements/calculate/base-spend'),
 ('POST', 'lta-agreements/calculate/planned-spend'),
}
# --- Z36 §5 (2026-08-26, ürün sahibi KABUL, W8 kapanışı): mechanic
# hesap-okuma ikilisi — POST ama yazma yüzeyi ÖLÇÜLDÜ 0 (T-267 B1 §S2),
# küme göç öncesi @Roles ile BİREBİR (5/5). `SHARED_CALC_READ_ROUTES`'un
# `MASTER_DATA` karşılığı — ayrı tablo, çünkü hedef hücre `MASTER_DATA_READ`
# (SHARED_READ değil). `validate-formula` ÇİFTİ BURAYA DAHİL DEĞİL —
# karar-bekler, mekanik POST→WRITE kuralına düşmeye devam eder.
MASTER_DATA_CALC_READ_ROUTES = {
 ('POST', 'master-data/mechanics/applicable'),
 ('POST', 'master-data/mechanics/check-combination'),
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
    key = (meth, path)
    if key in SHARED_POLICY_WRITE_ROUTES:   return 'SHARED_POLICY_WRITE','Z36'
    if key in SHARED_ENVELOPE_WRITE_ROUTES: return 'SHARED_ENVELOPE_WRITE','Z36'
    if key in SHARED_SPEND_WRITE_ROUTES:    return 'SHARED_SPEND_WRITE','Z36'
    if key in SHARED_CALC_READ_ROUTES:      return 'SHARED_READ','Z36'
    if key in MASTER_DATA_CALC_READ_ROUTES: return 'MASTER_DATA_READ','Z36'
    if key in APPROVAL_QUEUE_READ_ROUTES:   return 'APPROVAL_QUEUE_READ','Z37'
    # ⛔ Z42 §4/§5 (B3b-1 W9) — bu DÖRT dal fam+verb'DEN ve MODES_READ'in
    # genel türetiminden ÖNCE gelmek ZORUNDA (Z36/Z37 dallarıyla AYNI gerekçe):
    # hepsi GET, hepsi ilgili aile dizininin ALTINDA — genel kural olmasaydı
    # MODES_LEDGER_READ/MODES_IMPORT_READ/MODES_ONINVOICE_READ rotaları
    # MODES_READ'e, BUDGET_CHECK_READ'in ikisi MODES_READ/SHARED_READ'e,
    # MASTER_DATA_GOVERNANCE_READ'in ikisi mekanik POST→WRITE ile
    # MASTER_DATA_WRITE'a düşerdi.
    if key in MODES_LEDGER_READ_ROUTES:        return 'MODES_LEDGER_READ','Z42'
    if key in MODES_IMPORT_READ_ROUTES:        return 'MODES_IMPORT_READ','Z42'
    if key in MODES_ONINVOICE_READ_ROUTES:     return 'MODES_ONINVOICE_READ','Z42'
    if key in BUDGET_CHECK_READ_ROUTES:        return 'BUDGET_CHECK_READ','Z42'
    if key in MASTER_DATA_GOVERNANCE_READ_ROUTES: return 'MASTER_DATA_GOVERNANCE_READ','Z42'
    if key in BASELINE_WRITE_ROUTES:           return 'BASELINE_WRITE','F12'
    if key in MODES_READ_CROSS_ROUTES:         return 'MODES_READ','Z43'
    if path in SUMMARY:            return 'SUMMARY_READ','Z31/Z32'
    if path in APPROVE:            return 'MODES_APPROVE','YARGI'
    # ⛔ BU DAL fam+verb'DEN ONCE GELMEK ZORUNDA (code-reviewer S2, OLCULDU):
    # SUBMIT_RE'ye uyan BES rotanin BESI DE ayni anda modes_write_cell()'den
    # PLAN aliyor. Dallar takas edilirse G6 BES uyusmazlikla kirmiziya doner
    # (mutasyonla olculdu: dal kaldirilinca exit 2, besi de ADIYLA).
    # ⚠️ modes_write_cell()'in docstring'i "koruyan sey siradan DEGIL" diyor —
    # o cumle IC dongu cifti icin DOGRU, BU DIS dal icin TERSI gecerli.
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

TSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', '..', '..',
                        'docs', 'process', 'B3A_EK3_ROTA_HUCRE_ESLEMESI.tsv')

def check_tsv_drift(rows, out):
    """T-288 — commit'li TSV ile TAZE üretim BİREBİR mi.

    Vaka: commit'li TSV `W2` boyunca BİR DALGA BAYATLADI (tenant rotalarını
    hâlâ ROLES gösteriyordu) ve onu gören kapı YOKTU. Elle `diff` alınıyordu.

    ⛔ SKIPPED bir GEÇİŞ DEĞİL: dosya bulunamazsa exit 2 (SETUP HATASI) —
    money-float'ın dersi ("SKIPPED is not a pass") ve o ders yalnız runner
    onu grep'lediği için güvenliydi; burada SESSİZ GEÇİŞ hiç olmuyor.
    
    ⚠️ KAYNAK DISKTIR, `git show HEAD:` DEGIL (olculdu 2026-08-26,
    code-reviewer S6). Degisken adi `committed` ve cikti `commit=` diyor,
    ama okunan sey CALISMA AGACIDIR. Sonuc: "yeniden uretildi ama
    COMMIT'LENMEDI" ile "yeniden uretildi ve commit'lendi" AYNI ciktiyi
    verir -- yani T-288'in yakalamak icin yazildigi senaryonun bir yarisi
    bu kapinin disinda. Pratik telafi: TSV, uretici ve kod AYNI COMMIT
    SETINDE iner. Kalici cozum ayri bir tasktir.
    """
    path = os.path.normpath(TSV_PATH)
    if not os.path.exists(path):
        print(f'G7 TSV DRIFT: SETUP HATASI — bulunamadi: {path}', file=out)
        return None
    committed = [l.rstrip('\n') for l in io.open(path, encoding='utf-8')
                 if l.strip() and not l.startswith('#')]
    fresh = ['\t'.join(str(x) for x in r) for r in rows]
    # POZ.KONTROL: iki taraf da BOŞ DEĞİL — iki bos listenin esitligi rc=0 verir
    if not committed or not fresh:
        print(f'G7 TSV DRIFT: SETUP HATASI — bos taraf '
              f'(commit={len(committed)} taze={len(fresh)})', file=out)
        return None
    same = committed == fresh
    print(f'G7 TSV drift    commit={len(committed)} taze={len(fresh)} '
          f'{"BIREBIR" if same else "FARKLI"}', file=out)
    if not same:
        cs, fs = set(committed), set(fresh)
        for x in sorted(fs - cs)[:5]: print(f'   + taze: {x[:110]}', file=out)
        for x in sorted(cs - fs)[:5]: print(f'   - commit: {x[:110]}', file=out)
    return same

def reconcile(rows):
    """MUTABAKAT — exit 2 ile durduran bir kapi.

    KAPSAM: `run-all.sh` bu dosyayi CAGIRIR ve RC != 0'i IHLAL sayar
    (T-288 / 0522d51). Yani `npm run guards` yesilse bu mutabakat KOSMUSTUR.
    ⚠️ Onceki docstring "KAPSAMAZ" diyordu ve T-288'den sonra BAYATLADI --
    duzeltildi 2026-08-25 (code-reviewer S4). Dayanak: run-all.sh icinde
    `route-cell-map` cagrisi + `RCM_RC` kontrolu.

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

    # G2b -- Z36 override tablolari da ELLE YAZILMIS UYE LISTELERIDIR.
    #
    # ⛔ NEDEN AYRI BIR DONGU: bu tablolarin anahtari (METOD, yol) CIFTIDIR,
    # SUMMARY/APPROVE'un duz yol listesi degil. `paths` sayaci ile olculemezler
    # -- `POST budget/envelopes` ile `GET budget/envelopes` ayni yolu paylasir.
    #
    # ⛔ VE BU KAPININ GORMEDIGI YON: BAYAT uyeyi gorur, EKSIK uyeyi GORMEZ.
    # Bir sinifa ait olup listeye YAZILMAMIS rota, genel mekanik kurala duser
    # (SHARED_WRITE turetilir); GOCMUSSE G6 yakalar, GOCMEMISSE hicbir sey
    # yakalamaz. Yani G2b bir DRIFT dedektorudur, bir TAMLIK kanidi degil.
    #
    # ⚠️ VE G6'NIN STATUSU BU SATIRLARDA ZAYIFLADI: Z35'te turetim alt-modul+
    # fiil kuralindan MEKANIK geliyordu, yani G6 iki BAGIMSIZ yolu cakistiriyordu.
    # Z36'da turetim ELLE YAZILMIS bir enumerasyon -- G6 artik "insanin iki yere
    # yazdigi ayni mi" olcuyor. Drift dedektoru olarak degerli, CAPRAZ KANIT degil.
    #
    # Bu bosluk W4b'de ACILDI ve ayni turda kapandi: dort yeni tablo eklendi,
    # G2 onlari KAPSAMIYORDU. `DISIPLIN` -- "elle yazilmis uye-sayisi" ailesi ve
    # "bir duzeltme, duzelttigi SINIFIN yeni bir vakasini uretebilir".
    keys=Counter((r[1],r[2]) for r in rows)
    # ⛔ EVREN `cell_for`'UN KAYNAGINDAN TURETILIYOR (2026-08-27, Faz-B review B1)
    #
    # BIRINCI DENEME globals() uzerinden `*_ROUTES` + isinstance(set) idi ve
    # yorumu "bir tur tabloyu eklemeyi UNUTAMAZ" diyordu. O IDDIA YANLISTI —
    # code-reviewer IKI KACIS YOLUNU mutasyonla kanitladi:
    #   TIP EKSENI  tabloyu `list` yap  → evrenden dustu, olu uye GORUNMEDI,
    #               ama `key in [...]` calismaya devam etti ⇒ tablo CANLI, OLCULMUYOR
    #   AD EKSENI   `_ROUTES` → `_OVERRIDES` → ayni sonuc (12 satir → 11)
    # Ikisinde de `if not G2B_TABLOLAR` ATESLEMEDI: o kapi ancak TUM tablolar
    # yok olursa calisir. ⇒ SESSIZ FAIL-OPEN.
    #
    # 📌 Ve bu, duzeltmenin KENDI yorumunda andigi kuralin ihlaliydi:
    #    "bir DUZELTME, duzelttigi SINIFIN yeni bir vakasini uretebilir".
    #    Faz-B'nin actigi delik kapandi; yerine DAHA SESSIZ bir varyanti dogdu.
    #
    # ⇒ DOGRU EVREN: hukum veren yer `cell_for`'dur. Onun KAYNAGINDAN
    #   `if key in <AD>` dallarini cikar ve HER BIRININ olculdugunu zorunlu kil.
    #   Ad ve tip artik SERBEST — kacis yolu yok, cunku evren `cell_for`'un
    #   kendisidir. (`docs/DISIPLIN.md`: "DORDUNCU SORU — kontrolun girdisi,
    #   kontrol ettigi seyden mi turuyor?" Hayir: girdi HUKUM VEREN KODDUR,
    #   olculen ise TABLOLARIN ICERIGI.)
    import inspect, re as _re
    hukum_verenler = _re.findall(r'if key in ([A-Za-z_][A-Za-z0-9_]*)',
                                 inspect.getsource(cell_for))
    G2B_TABLOLAR = []
    for ad in hukum_verenler:
        tablo = globals().get(ad)
        if tablo is None or not hasattr(tablo, '__contains__'):
            err.append(f'G2b TABLO COZULEMEDI: cell_for `{ad}` ile hukum veriyor '
                       f'ama o ad modul duzeyinde bir uyelik yapisi degil.')
            continue
        G2B_TABLOLAR.append((ad, tablo))
    if not hukum_verenler:
        err.append('G2b EVREN BOS: cell_for kaynagindan hicbir `if key in X` '
                   'dali cikarilamadi — turetim bozuldu (bir kapi olcecek sey '
                   'bulamiyorsa YOKTUR).')
    for name, decl in sorted(G2B_TABLOLAR):
        dead=sorted(m for m in decl if keys.get(m,0)==0)
        dup =sorted(m for m in decl if keys.get(m,0)>1)
        print(f'G2b {name:34s} bildirilen={len(decl)} olu={len(dead)} '
              f'cift={len(dup)}', file=out)
        for m in dead: err.append(f'G2b {name} OLU UYE (hicbir rotaya dusmuyor): {m[0]} {m[1]}')
        for m in dup:  err.append(f'G2b {name} CIFT UYE: {m[0]} {m[1]}')
    print(f'G2b evren  cell_for hukum-dali={len(hukum_verenler)} '
          f'olculen={len(G2B_TABLOLAR)}', file=out)

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
    # ⛔ W6 (2026-08-26) — KAPSAM DARALTILDI: yalnız ROLES-turu (henuz gocmemis)
    # satirlar. Gocen (CAP) bir rotada @Roles SILINIR (r[3]='-'), yani bu
    # kontrol EXPECT kumesiyle asla eslesmez ve GOCUN KENDISINI "uyusmazlik"
    # diye raporlar — göçün BAŞARISINI hata sayardı (Z29). CAP-turu satirlarin
    # capraz-kontrolu zaten G6'nin isi (beyan @RequireCapability argumani ↔
    # mekanik turetim); G5 ve G6 AYNI SEYI IKI KEZ olcmuyor, G5 gocmemis
    # kalani, G6 gocmusu kapsiyor. Tum uyeler goctugunde G5'in evreni
    # DOGAL OLARAK SIFIRLANIR — bu bir kor-nokta degil, is teslimi.
    mism=[]
    for r in rows:
        if r[4] in EXPECT and r[6]=='ROLES':
            got=set(r[3].split(',')) if r[3]!='?' else set()
            if got!=EXPECT[r[4]]: mism.append((r[4],r[1],r[2],r[3]))
    n_split=sum(1 for r in rows if r[4] in EXPECT and r[6]=='ROLES')
    print(f'G5 Z35 bolunmesi   uye={n_split}  @Roles uyusmazligi={len(mism)}', file=out)

    # ⛔ EVREN BOSALDIGINDA KAPI SUSMAZ — GOREV DEVRINI KANITLAR (W6, 2026-08-26)
    #
    # W6 EXPECT hucrelerinin TAMAMINI gocurdu ⇒ G5'in evreni SIFIRLANDI.
    # Bu savunulabilir (G6 gocmusu kapsiyor) AMA sessiz birakilamaz:
    # §2.7 #9 — "kapsami kendini bosaltan kapi, TEMIZ ile BOS'u ayni cikti ile
    # raporlar; sinyal SABITSE sinyal DEGILDIR" (T-100'un kanonik vakasi).
    #
    # ⇒ Bos evren bir ISTIRAHAT degil, bir DEVIR IDDIASIDIR — ve iddia OLCULUR:
    #   EXPECT hucreli her satir ya ROLES (G5'in isi) ya CAP (G6'nin isi) olmali.
    #   Ucuncu bir tur varsa O SATIR HICBIR KAPININ KAPSAMINDA DEGILDIR.
    # ⛔ ONCEKI "DEVIR KANITI" KALDIRILDI (code-reviewer B2, 2026-08-26).
    # Iki dal YAPISAL OLARAK ERISILEMEZDI: r[6] tek bir yerde (:630) ve IKILI bir
    # uclu-operatorden dogar ('CAP' if has_cap else 'ROLES') ⇒ ucuncu deger
    # IMKANSIZ. Ve dali atesleyen mutasyon O UCLU-OPERATORU degistirmek zorunda
    # kaldi ⇒ KANIT KURULUMU OLCULEN DURUMU URETTI (§2.7 #4).
    # ⚠️ Daha kotusu: erisilemez dallar kapinin KIRMIZI VEREBILDIGI IZLENIMINI
    # yaratiyordu — oysa G5 hicbir gercek girdide kirmizi VEREMIYORDU.
    # (Ucuncusu `ortada` zaten G4'un ikinci kopyasiydi — §2.7 #8.)
    #
    # ⇒ §2.7 #9'a verilen cevap §2.7 #4'un yeni bir vakasi oldu. Dogru cevap
    #   asagida: kapiya BAGIMSIZ BIR REFERANS vermek.

    # ==================================================================
    # G5b — Z35 HUKMU <-> ROLE_CAPABILITIES  (kapinin GERCEK isi)
    # ==================================================================
    # ⛔ NEDEN: W6 EXPECT hucrelerinin TAMAMINI gocurdu ⇒ G5'in @Roles evreni
    # SIFIRLANDI ve kapi HICBIR GIRDIDE kirmizi veremez oldu. Olculdu
    # (code-reviewer B1): PLANNER'a MODES_ACTUALS_WRITE verildiginde — yani
    # Z35'in TAM OLARAK yasakladigi sey — cikti `exit 0` ve G5 ihlali
    # EKRANA BASIP GECTI (`EXPECT[...] = ['ADMIN','FINANCE','PLANNER']`).
    #
    # ⚠️ VE "G6 kapsiyor" IDDIASI OLCUMLE YANLISTI: G6 `beyan != turetim`
    # yapar — hucre ADINI olcer, hucrenin ROL KUMESINI DEGIL. ROLE_CAPABILITIES
    # G6'nin girdisi bile degil. G5'in isi devredilmedi, DUSTU.
    #
    # ⇒ COZUM: kapiya BAGIMSIZ bir referans ver. EXPECT ROLE_CAPABILITIES'ten
    #   turer; onu KARAR KAYDININ hukmuyle cakistir. Boylece
    #   "DORDUNCU SORU" saglanir: kontrolun girdisi, kontrol ettigi seyden
    #   TUREMIYOR — ve evren asla bosalmaz (kaynak kod, rota degil).
    # ⛔ GENISLETILDI (2026-08-26, `Z42` W9 review BLOCKER 1) — VE SEBEP
    # KAPININ KENDI DERSININ TEKRARIYDI:
    #
    #   G5 W6'da OLDU cunku EVRENI (@Roles rotalari) BOSALDI.
    #   G5b onun yerine kuruldu — ve EVRENI IKI HUCREDE DONDU.
    #   W9 BES YENI hucre acti; ucu de bu tabloya girmedi ⇒ kapi onlari
    #   GORMUYORDU. Mutasyonla kanitlandi: ROLE_CAPABILITIES[READONLY] +=
    #   MODES_LEDGER_READ  →  `npm run guards` exit 0, `npm test` exit 0,
    #   guard ciktisi FARK YOK. Ayni genisleme MODES_ACTUALS_WRITE'a
    #   uygulandiginda kapi ANINDA kirmizi verdi (poz. kontrol).
    #
    # ⇒ "Bes satir ekle" bugunu kapatirdi, SINIFI degil: bir sonraki dalga
    #   ayni deligi yeniden acardi. Bu yuzden IKI sey birden yapildi:
    #     1. tablo GOCMUS ROTA TASIYAN HER HUCREYE genisletildi
    #     2. G5c: tabloda OLMAYAN bir hucre gocmus rota tasiyorsa IHLAL
    #   Boylece evren BIR DAHA donamaz — yeni hucre acan tur, hukmunu de
    #   yazmak ZORUNDA. (`docs/DISIPLIN.md`: "bir kapi aginin KENDI
    #   SAGLIGINI olcmesi" · "elle yazilmis uye-sayisi dokuzda dokuz".)
    #
    # ⚠️ Bu tablo bir BASELINE'dir: olculdugu anda dondurulmustur ve KENDINI
    #   ASLA YENIDEN URETMEZ. Bir kume degisikligi burayi da degistirmeyi
    #   gerektirir — ve o degisiklik bir KARAR KAYDI ister, sessiz duzenleme
    #   DEGIL. Kaynak hukumler: `Z35` (MODES_*_WRITE bolunmesi) · `Z36 §5`
    #   (SHARED_* uclusu) · `Z37 §3` (APPROVAL_QUEUE_READ) · `Z42 §4-§5`
    #   (W9'un bes yeni hucresi) · digerleri W1-W8'in birebir gocu.
    KARAR_HUKMU = {
        'ADMIN_READ': {'ADMIN'},
        'APPROVAL_QUEUE_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'READONLY'},
        'BUDGET_CHECK_READ': {'ADMIN', 'CATEGORY_MANAGER', 'PLANNER', 'READONLY'},
        'CUSTOMER_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'PLANNER', 'READONLY'},
        'CUSTOMER_WRITE': {'ADMIN', 'PLANNER'},
        'MASTER_DATA_GOVERNANCE_READ': {'ADMIN'},
        'MASTER_DATA_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'PLANNER', 'READONLY'},
        # ⛔ ~~GENİŞLETİLDİ (ürün sahibi hükmü, 2026-09-02, `BL-2` kapanış
        # paketi §3) — {ADMIN} → {ADMIN,FINANCE}. Gerekçe: baseline hacim
        # yükleyicisi (merkezi master-data) planın ÖLÇÜLDÜĞÜ referanstır;
        # PLANNER kendi referansını yüklerse düşük-baseline → yüksek-uplift
        # yapısal açığı doğar (GÖREV AYRILIĞI). PLANNER bu hücrede YOK.
        # Canlı taraf: `src/common/authorization/capabilities.ts` FINANCE
        # bloğu, MASTER_DATA_WRITE satırı.~~
        # ⛔ GERİ ALINDI (`F12`, ürün sahibi hükmü, 2026-09-02, düzeltme
        # turu) — hüküm YANLIŞ HÜCREYE verilmişti: `MASTER_DATA_WRITE`
        # yalnız baseline upload değil KPI/mekanik/SKU/CPL/tactic/brand/
        # channel/category/FU yazma uçlarını da taşıyor; genişleme 11
        # e2e'yi kırdı. Baseline gerekçesi geçerliliğini KORUYOR — yeni ve
        # dar `BASELINE_WRITE` hücresinde (aşağı bkz.).
        'MASTER_DATA_WRITE': {'ADMIN'},
        # ✅ DOĞDU (`F12` düzeltme turu, ürün sahibi hükmü, 2026-09-02,
        # `BL-2` kapanış paketi §2, `Z42` usulü) — yalnız
        # `master-data/baseline-volumes/upload` rotasını taşır. Canlı
        # taraf: `src/common/authorization/capabilities.ts` FINANCE ∧ ADMIN
        # bloğu, BASELINE_WRITE satırı.
        'BASELINE_WRITE': {'ADMIN', 'FINANCE'},
        'MODES_ACTUALS_WRITE': {'ADMIN', 'FINANCE'},
        'MODES_IMPORT_READ': {'ADMIN', 'FINANCE'},
        'MODES_LEDGER_READ': {'ADMIN', 'FINANCE', 'PLANNER', 'READONLY'},
        'MODES_ONINVOICE_READ': {'ADMIN', 'FINANCE', 'PLANNER', 'READONLY'},
        'MODES_PLAN_WRITE': {'ADMIN', 'PLANNER'},
        'MODES_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'PLANNER', 'READONLY'},
        'MODES_SUBMIT': {'ADMIN', 'PLANNER'},
        'NOTIFICATION_WRITE': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'PLANNER', 'READONLY'},
        'SHARED_ENVELOPE_WRITE': {'ADMIN', 'FINANCE'},
        'SHARED_POLICY_WRITE': {'ADMIN'},
        'SHARED_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'PLANNER', 'READONLY'},
        'SHARED_SPEND_WRITE': {'ADMIN', 'PLANNER'},
        'SUMMARY_READ': {'ADMIN', 'CATEGORY_MANAGER', 'FINANCE', 'READONLY'},
        'TENANT_READ': {'ADMIN'},
        'TENANT_WRITE': {'ADMIN'},
        'USER_MANAGE': {'ADMIN'},
        'USER_WRITE': {'ADMIN'},
    }
    gocen_hucre = {r[4] for r in rows if r[6] == 'CAP'}
    # ⚠️ EVREN: `EXPECT` DEGIL. `EXPECT` yalniz IKI Z35 hucresini tasir
    # (`:514`); onu kullanmak 23 hucreyi "BOS" gosterirdi — kapinin girdisi
    # ARANANDAN DAR olurdu (`DISIPLIN`: "kapsam maskelemesi — desen calisir,
    # EVREN eksiktir"). Canli harita DOGRUDAN okunur.
    HARITA = role_caps_inverse()
    for c, hukum in sorted(KARAR_HUKMU.items()):
        canli = set(HARITA.get(c, set()))
        if canli != hukum:
            err.append(
                f'G5b KARAR HUKMU IHLAL: {c} — dondurulmus hukum '
                f'{sorted(hukum)}, ROLE_CAPABILITIES {sorted(canli) or "BOS"}. '
                f'Bir hucrenin ROL KUMESI bir KARARDIR; degisiklik bir Z-kaydi '
                f'ISTER, sessiz duzenleme DEGIL.')
    ihlal = sum(1 for c, h in KARAR_HUKMU.items()
                if set(HARITA.get(c, set())) != h)
    print(f'G5b karar hukmu  kontrol={len(KARAR_HUKMU)} ihlal={ihlal}', file=out)

    # ── G5c — EVREN DONMASIN. Gocmus rota tasiyan HER hucre tabloda olmali.
    # Bu, G5b'nin W9'da dusmesine sebep olan mekanizmayi kalici kapatir:
    # kapinin evreni artik ELLE degil, GOCEN ROTALARDAN turer.
    hukumsuz = sorted(gocen_hucre - set(KARAR_HUKMU))
    if hukumsuz:
        err.append(
            f'G5c HUKUMSUZ HUCRE: {hukumsuz} — gocmus rota tasiyor ama '
            f'KARAR_HUKMU tablosunda YOK. G5b bu hucrelerin rol kumesini '
            f'GORMUYOR (W9 BLOCKER 1). Yeni hucre acan tur, hukmunu de yazar.')
    print(f'G5c hukumsuz hucre  gocen={len(gocen_hucre)} '
          f'hukumlu={len(KARAR_HUKMU)} hukumsuz={len(hukumsuz)}', file=out)

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

    # G7 — TSV DRIFT (T-288)
    drift = check_tsv_drift(rows, out)
    if drift is None:
        err.append('G7 TSV drift OLCULEMEDI (SETUP HATASI, yukari bkz)')
    elif not drift:
        err.append('G7 TSV DRIFT: commit\'li TSV ile taze uretim AYRISIYOR — '
                   'artefakt bayat. Yeniden uret ve AYNI commit setinde guncelle.')

    # ==================================================================
    # G8 — HARITA <-> URETICI BIREBIRLIGI  (Z39 / dalga-sonu H3'un KAPISI)
    # ==================================================================
    # ⛔ NEDEN VAR: Z39 "bir kural, TETIKLEYICISI OLMADAN bir TEMENNIDIR" dedi
    # ve kurali YINE BIR METIN olarak birakti. code-reviewer mutasyonla olctu:
    # CUSTOMER_MANAGE sifir rotayla GERI EKLENDIGINDE butun kapilar YESIL kaldi.
    # Yani H3'un bir dalga boyunca uygulanmamasinin sebebi tam olarak buydu.
    #
    # IKI YON:
    #   (a) CAPABILITIES'te olup URETILEMEYEN hucre  -> sifir-rota adayi
    #   (b) URETILEN ama CAPABILITIES'te OLMAYAN hucre -> hayalet hedef
    #       (:383'un kendi yorumu bunu isaret ediyordu: listeye yazilmamis bir
    #        `shared` yazma rotasi SHARED_WRITE turetir, ve o sabit artik YOK)
    #
    # ⚠️ BEKLEME LISTESI ACIK VE GEREKCELI: dalgasi gelmemis hucre KUSUR DEGIL.
    # Dalga kapanisinda o satir DUSER (dalga-sonu H3). Liste burada durur ki
    # "hangi turun isi" sorusu cevapsiz kalmasin.
    KAYITLI_ISTISNA = {
        # Z20: yazili kural + uretici dali (:234) + ROTASI var — H3-uyumlu TAM bicim
        'USER_MANAGE',
    }
    # ⛔ LISTE OLCULEREK DARALTILDI (2026-08-26). Ilk yazimda DOKUZ uye vardi;
    # SEKIZI TASIYICI DEGILDI — o hucreler ZATEN URETILIYOR (rotalari `@Roles`'ta
    # duruyor ama hucre kolonu doluyor), yani `olu` kontrolune HIC dusmuyorlardi.
    #
    # ⚠️ VE BU, AYNI TURDA YAZILAN KURALIN IHLALIYDI: "istisna listeleri de birer
    # KAPIDIR ve kapinin kendisi kadar disiplin ister". Tasiyici olmayan bir giris
    # BUGUN hicbir seyi susturmaz — YARIN susturur, ve kimse fark etmez.
    #
    # ⇒ KURAL: bir istisna listesine giris eklemeden once OLC — "bu giris
    #   kaldirilirsa kapi BUGUN kirmiziya doner mi?" Cevap hayirsa giris
    #   GEREKSIZDIR ve yazilmaz.
    # ⛔ W8 KAPANDI (2026-08-26, dalga-sonu H3) — `MASTER_DATA_MANAGE` LISTENIN
    # TEK TASIYICI uyesiydi. Kapanista OLCULDU: `@RequireCapability(CAPABILITIES.
    # MASTER_DATA_MANAGE)` deseni `*.controller.ts` genelinde SIFIR eslesme
    # (dokuz katalog controller'i + kpi + mechanic, 19+45 rotanin HICBIRI onu
    # turetmedi). Rota ALMADI -> DUSTU (CAPABILITIES.ts'ten SILINDI, F12 izli).
    # Liste bu yuzden BOS — bir sonraki dalganin BEKLEYEN'i kendi turunde acar.
    BEKLEYEN: set[str] = set()
    bildirilen = set(re.findall(r'^  ([A-Z_]+): \'[a-z\-]+:[a-z\-]+\',',
                                src(CAPS_TS), re.M))
    uretilen = {r[4] for r in rows if r[4] and r[4] not in ('-', 'beyan')}
    # ⛔ HAYALET TARAFININ KAYITLI ISTISNASI — ve SARTI: KARARINI ADIYLA SOYLER
    # Bir hucre DUSTUYSE ama ona ait rotalar HENUZ GOCMEDIYSE, uretici mekanik
    # kuralla o olu adi turetmeye devam eder. Bu bir KUSUR DEGIL, bir ACIK
    # KARARIN goruntusudur — ama SESSIZ kalmamali.
    # ⚠️ Her giris bir KARAR KAYDI adlandirmak ZORUNDA: kayitsiz bir hayalet
    # hala IHLALDIR (yoksa bu liste "sustur" dugmesi olur).
    KARAR_BEKLEYEN_HEDEF = {
        # Z39 §4: SHARED_WRITE dustu; LTA dortlusu T-293 cozulmeden ZATEN
        # gocmeyecekti. "Dogru hucre, KARARLA ve CUMLESIYLE o gun dogar."
        'SHARED_WRITE': 'Z39 §4 / T-293',
    }
    olu = sorted(bildirilen - uretilen - KAYITLI_ISTISNA - BEKLEYEN)
    hayalet = sorted(uretilen - bildirilen - set(KARAR_BEKLEYEN_HEDEF))
    for c, kayit in sorted(KARAR_BEKLEYEN_HEDEF.items()):
        if c in uretilen:
            print(f'G8 karar-bekleyen hedef: {c} (kayit: {kayit}) — uretici '
                  f'turetiyor, hucre DUSMUS, rotalari HENUZ gocmedi', file=out)
    print(f'G8 harita<->uretici  bildirilen={len(bildirilen)} '
          f'uretilen={len(uretilen)} bekleyen={len(BEKLEYEN)} '
          f'olu={len(olu)} hayalet={len(hayalet)}', file=out)
    for c in olu:
        err.append(f'G8 SIFIR-ROTA HUCRE: {c} — CAPABILITIES\'te var, hicbir rota '
                   f'turetmiyor. Z39/dalga-sonu H3: "arkasinda rota olmayan bir '
                   f'hucre haritada DURMAZ". Ya dusur, ya BEKLEYEN listesine '
                   f'GEREKCESIYLE ekle, ya KAYITLI_ISTISNA yap (yazili kural + '
                   f'uretici dali + rota).')
    for c in hayalet:
        err.append(f'G8 HAYALET HEDEF: {c} — uretici bu hucreyi turetiyor ama '
                   f'CAPABILITIES\'te YOK. Bir rota var olmayan bir hucreye '
                   f'atanmis olabilir.')

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
    # ⛔ SUTUN BASLIGI URETICIDEN BASILIR (code-reviewer S1, 2026-08-26).
    # Onceden dort `#` satirinin DORDU DE ELLE ekleniyordu ve bu turda ucu
    # hatirlanip DORDUNCUSU (sutun basligi) UNUTULDU — sekiz sutunlu, BASLIKSIZ
    # bir TSV kaldi.
    # ⚠️ VE G7 BUNU YAPISAL OLARAK GOREMEZ: drift kontrolu `#` satirlarini
    # FILTRELIYOR (:281), yani kayip her yeniden uretimde SESSIZCE TEKRARLAR.
    # ⇒ Basligi ureticiye tasimak "elle-hatirlama" sinifini kapatir:
    #   artefakt artik KENDINI TARIF EDIYOR, ve G7'nin filtresi korunuyor.
    print('#dosya\tYÖNTEM\tyol\t@Roles\thücre\tkaynak\tkapsam\tbeyan')
    for r in rows: print('\t'.join(str(x) for x in r))
    if err_two_mech:
        print('⛔ İKİ MEKANİZMA aynı rotada (single-mechanism atlandı mı?):',
              file=sys.stderr)
        for x in err_two_mech: print('   ', x, file=sys.stderr)
        return 2
    print(f'# TOPLAM {len(rows)}', file=sys.stderr)
    return reconcile(rows)

if __name__=='__main__': sys.exit(main())
