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
# --- MODES_APPROVE: onay KARARI ---
APPROVE_RE = re.compile(r'/(approve|reject|approval-decision)(/|$)')

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
            if s.startswith('@Roles('): blk=grab(L,k); break
            if s.endswith('}') and not s.startswith('@'): break
    if not blk:
        for l in L[:ln]:
            if l.strip().startswith('@Roles('): blk=l.strip(); break
    if not blk: return '?'
    got=set(re.findall(r'UserRole\.([A-Z_]+)',blk))
    for sp in re.findall(r'\.\.\.([A-Za-z_][\w]*)',blk): got |= resolve(sp)
    return ','.join(sorted(got)) if got else '?'

def cell_for(f, meth, path):
    d = re.sub(r'^src/modules/','',f).split('/')[0]
    fam = FAM.get(d,'?')
    if path in SUMMARY:            return 'SUMMARY_READ','Z31/Z32'
    if fam=='MODES' and APPROVE_RE.search('/'+path): return 'MODES_APPROVE','YARGI'
    if fam=='MODES' and SUBMIT_RE.search('/'+path):  return 'MODES_SUBMIT','Z35'
    verb = 'READ' if meth=='GET' else 'WRITE'
    if fam=='USER' and verb=='READ':                 return 'USER_MANAGE','Z20'
    return f'{fam}_{verb}','MEKANIK'

def main():
    awk='scripts/guards/route-scope.awk'
    files=sorted(glob.glob('src/**/*.controller.ts',recursive=True))
    out=subprocess.run(['awk','-f',awk]+files,capture_output=True,text=True).stdout
    n=0
    for line in out.splitlines():
        c=line.split('\t')
        if len(c)<8 or c[4]!='1': continue
        f,ln,meth,path = c[0],int(c[1]),c[2],c[3]
        cell,srcn = cell_for(f,meth,path)
        print('\t'.join([f,meth,path,roles_for(f,ln),cell,srcn]))
        n+=1
    print(f'# TOPLAM {n}', file=sys.stderr)

if __name__=='__main__': main()
