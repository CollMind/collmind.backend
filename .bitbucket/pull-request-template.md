# Pull Request

## SAFE PROMPT Referansı
- Sprint      : 
- Prompt dosyası : `docs/safe-prompts/`
- Phase       : IMPLEMENT | HOTFIX

---

## Değişiklik özeti
<!-- Ne değişti, neden -->

## Repo kapsamı
- [ ] Backend only
- [ ] Frontend only  
- [ ] Her ikisi — backend PR önce merge edildi ✅

---

## Checklist

### Kod
- [ ] Feature branch'ten açıldı (`feature/*` → `staging`)
- [ ] `staging` veya `main`'e direkt commit yok
- [ ] TypeScript derleme hatasız (`tsc --noEmit`)
- [ ] Lint temiz

### Migration (varsa)
- [ ] Migration dosyası PR'a dahil
- [ ] `down()` yazıldı
- [ ] Local'de `run → revert → run` test edildi
- [ ] Windsurf migration'ı çalıştırmadı — geliştirici çalıştıracak

### Seed (varsa)
- [ ] Upsert pattern kullanıldı (`insert()` yok)
- [ ] Mevcut staging verisi silinmiyor

### Test
- [ ] İlgili E2E / unit testler güncellendi veya kapsam dışı gerekçesi var

### Staging deploy (merge sonrası)
- [ ] Migration çalıştırıldı: `npm run migration:run:prod`
- [ ] Servis yeniden başlatıldı: `pm2 restart collmind-backend`
- [ ] Smoke test yapıldı

---

## İki repo feature'ı ise
- [ ] `collmind-backend` PR **önce** merge edildi
- [ ] Backend staging'de 5 dk doğrulandı
- [ ] Bu frontend PR **sonra** açıldı
