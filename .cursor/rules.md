📌 CURSOR AI PROJECT RULES

Project: CollMind TPM – Trade Promotion Management System

Main Document Path: CollMind_TPM_BRD_v1.0.pdf
Code Prompts: TPM_Base_BRD_Code_Prompts.pdf
KPI Details: KPI_Details.docx
KPI Engine Promps: KPI_Engine_Prompts.pdf

1️⃣ GENEL PROJE KURALLARI (ZORUNLU)

Bu proje FMCG Trade Promotion Management (TPM) ürünüdür

Tüm geliştirmeler BRD (Business Requirements Document) ile uyumlu olmak zorundadır

Excel-benzeri ama gerçek zamanlı hesaplama yapan web uygulaması varsayılmalıdır

Hesaplamalar frontend’de hardcode EDİLEMEZ, her zaman konfigüre edilebilir olmalıdır

❌ KPI, ROI, Spend, Profit gibi hesaplar kod içine gömülemez
✅ Her KPI Admin tarafından tanımlı formülden çalışır

2️⃣ ROL & YETKİ MODELİ (DEĞİŞTİRİLEMEZ)

Sistem RBAC (Role Based Access Control) kullanır.

Roller

Planner (Trade Marketing Planner)

Category Manager

Finance Manager

Admin

Temel Kurallar

Planner → sadece yetkili CPL + Category görür

Category Manager → sadece atanmış Category planlarını onaylar

Finance Manager → okuma + bütçe yönetimi

Admin → tam yetki

❌ Bir rol başka rolün yetkisini kullanamaz
❌ Planner plan onaylayamaz
❌ Category Manager plan düzenleyemez

3️⃣ PROMOTION PLAN YAŞAM DÖNGÜSÜ (STATE MACHINE)

Plan durumları KESİNLİKLE aşağıdaki gibidir:

Draft
→ Pending Approval
→ Approved
→ Rejected → Draft


Kurallar:

Pending Approval durumunda plan DEĞİŞTİRİLEMEZ

Approved plan bütçeden düşer

Rejected plan tekrar Draft olur ama audit log korunur

4️⃣ PLANNING GRID KURALLARI (KRİTİK)
Hiyerarşi
Plan
 └─ FU (Forecasting Unit)
     └─ SKU

Veri Girişi Kuralları

SKU level → Planned Volume girilir

FU level → Tactic (discount, lumpsum) girilir

FU seviyesindeki değerler SKU’ya miras kalır

SKU seviyesinde tactic DEĞİŞTİRİLEMEZ

5️⃣ KPI & HESAPLAMA MOTORU (EN KRİTİK KURAL)

KPI’lar Admin tarafından tanımlanan dinamik formüllerle hesaplanır

Frontend sadece sonucu render eder

Hesaplama süresi < 500ms olmalıdır

KPI dependency sırası zorunludur

Edge Case Kuralları

Division by zero → null

Eksik veri → null

Negatif ROI → geçerli değerdir (hata değildir)

6️⃣ RAG (RED–AMBER–GREEN) KURALLARI

RAG sadece KPI konfigürasyonuna göre belirlenir

Hardcoded threshold YASAKTIR

Aggregation

SKU Red → FU Red

Karışık → FU Amber

Hepsi Green → FU Green

7️⃣ SUBMIT & APPROVAL KURALLARI
Submit için zorunlu şartlar:

En az 1 FU

Validasyon hatası yok

Bütçe yeterli

(Opsiyonel) Overall ROI Red ise submit engellenebilir

Approval

Reject → yorum zorunlu

Approve → bütçe anında düşülür

Approval action audit log’a yazılır

8️⃣ BUDGET KURALLARI (FINANCE OWNERSHIP)

Bütçeler:

Period (Month / Quarter / Year)

Channel

Category (opsiyonel)

Ayrı ayrı:

On-Invoice

Off-Invoice

Threshold’lar

%80 → Warning

%95 → Critical

%100+ → Exceeded (block)

9️⃣ ADMIN KONFİGÜRASYON PRENSİPLERİ

Admin aşağıdakileri kod değişmeden yapabilmelidir:

KPI ekleme / düzenleme

Formula tanımı

Tactic applicability (channel + category)

Min / Max değerler

Kullanıcı yetkileri (CPL → Category)

🔍 10️⃣ AUDIT & COMPLIANCE (ZORUNLU)

Tüm işlemler immutable audit log ile tutulur

Kim, ne zaman, neyi değiştirdi

Onay / red işlemleri DAHİL

❌ Audit log silinemez
❌ Audit log güncellenemez

11️⃣ TEKNİK VARSAYIMLAR

Web-based SaaS

Desktop-first UI

Grid-heavy ekranlar

Real-time recalculation

Optimistic locking (eş zamanlı düzenleme)

🧠 CURSOR AI DAVRANIŞ KURALI (META)

Cursor AI:

Kod yazarken önce bu kuralları kontrol eder

Varsayım yapmaz, BRD’ye sadık kalır

“Bu projede genelde böyle olur” yaklaşımı KULLANMAZ

FMCG / TPM domain terminolojisini kullanır

✅ Bu kurallar:

Cursor Rules

.cursor/rules.md

ya da Project Instructions

içine direkt yapıştırılabilir.

İstersen bir sonraki adımda:

🔹 Backend için ayrı Cursor Rules

🔹 Frontend (React Grid) özel kuralları

🔹 Domain-Driven Design (DDD) rule set

🔹 AI’nin test yazarken uyması gereken kurallar

hangisini istediğini söyle, onu da net bir rule dosyası olarak çıkarayım.