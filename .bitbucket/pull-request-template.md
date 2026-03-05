## SAFE PROMPT Referansı
- [ ] Bu PR bir SAFE PROMPT'a dayanıyor
- [ ] SAFE PROMPT dosyası: `docs/safe-prompts/[dosya-adı].md`
- [ ] Branch & Deployment Plan (Block 3) tamamlandı
- [ ] Migration varsa Migration Safety (Block 4) tamamlandı

---

## Değişiklik özeti
<!-- Ne yapıldı, neden yapıldı — 2-3 cümle -->

## Migration
- [ ] Bu PR DB migration içermiyor
- [ ] Migration içeriyor → Local'de test edildi, down() yazıldı
  - Migration dosyası: `src/database/migrations/[timestamp]-[isim].ts`

## Scope kontrolü
- [ ] OUT of scope dosyalara dokunulmadı
- [ ] Seed değişikliği varsa upsert pattern kullanıldı
- [ ] `*.spec.ts` dosyaları kapsam dışındaysa değiştirilmedi
- [ ] READONLY yalnızca GET endpoint'lere eklendi (varsa)

## Windsurf self-check
- [ ] `tsc --noEmit` backend → 0 hata
- [ ] `tsc --noEmit` frontend → 0 hata
- [ ] Verification grep'leri çalıştırıldı (SAFE PROMPT Block 8-A)

## Reviewer notu
<!-- Reviewer'ın özellikle dikkat etmesi gereken nokta varsa yaz -->
