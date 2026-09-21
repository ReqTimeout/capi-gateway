# capi-gateway

Fan-out WA click → Meta CAPI (+ Google EC nyusul P9) + ingest dashboard.

- `POST /sgb/wa` (header `X-Client-Key`) — body: `{event_id?, event_time?, page_url, fbc?, fbp?, phone_hash?, ua?, source?}` → kirim `Lead` ke Meta CAPI (retry 3x) + push `wa_click` ke SGB ingest.
- `POST /sgb/meta` — event Meta generik `{event_name, ...sama}`.
- `POST /sgb/google` — 501 sampai kredensial Ads ada.
- `GET /healthz`.

Dedupe vs Pixel: browser kirim `event_id` yang SAMA ke `fbq('track','Contact')` dan ke endpoint ini → Meta merge otomatis (tidak dobel hitung).

Deploy: Coolify project `agency-beriklan`, domain `capi.beriklan.co.id`, limit 256MB/0.25CPU.
