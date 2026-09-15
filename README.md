# Yuvarlak Masa (Vercel sürümü)

Gemini, Claude ve DeepSeek'in tartıştığı, senin moderatör olduğun masa. Sunucusuz; transkript tarayıcıda tutulur.
Masaya tartışma materyali (metin, link, PDF/Word dosyası) konabilir; modeller cevaplarında ona atıf yapar.

## Dağıtım
1. Bu klasörü bir GitHub deposuna yükle.
2. vercel.com → Add New Project → depoyu seç → Deploy.
3. Project → Settings → Environment Variables:
   - `GEMINI_API_KEY`
   - `CLAUDE_API_KEY`
   - `DEEPSEEK_API_KEY` (isteğe bağlı; tanımlanırsa üçüncü katılımcı olarak DeepSeek açılır)
   - isteğe bağlı: `GEMINI_MODEL`, `CLAUDE_MODEL`, `DEEPSEEK_MODEL`, `GEMINI_THINKING`
   - `ACCESS_CODE`: tanımlanırsa siteyi paylaştığın kişiler bu kodu girmeden senin anahtarlarını kullanamaz (kendi anahtarını girenler muaf)
4. Redeploy.

## Yerel çalıştırma (isteğe bağlı)
```bash
npm i -g vercel
vercel dev
```
