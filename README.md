# Deep & Honey · Eternal Contract (v2.7 DH)
- **v2.7 DH (HTML email):** every important field from the **Day section** and the **Pre-Scene Execution Affidavit** now appears in the exported HTML email, neatly grouped under "♥ Day Section" and "♥ Pre-Scene Execution Affidavit" sub-headings per day: execution date & time, ALL checklist items (✓ Confirmed / ○ Pending — unticked ones are shown too), Safeword Verification table (RED/YELLOW/GREEN spoken by Submissive/Dominant), non-verbal signal confirmation, Final Consent Declaration ticks, full Toy Inventory (every item with conditions + location), Scene Debrief (satisfaction/aftercare scores, safeword-used Yes/No + which one, adjustments, notes), debrief signature dates, plus activity timings, special requests and signature statuses. Home-screen badge + What's-new toast updated to v2.7 DH automatically via `APP_VERSION`.
- **v2.6 DH (HTML email):** the exported HTML email is now fully self-contained and Drive-link-free — NO "View on Google Drive" text or anchors anywhere. Sign, stamp and logo render in every HTML previewer via compressed base64 embeds with a pixel-link → inline-SVG fallback chain (never blank). Style upgraded to a romantic & professional look: rose-bordered banner with the Soulmate Code wordmark + heart tagline, and a love-stamp footer with quote. ALL important data is included: Contract Overview (contract no., effective date, printed names, special requests, days covered, safewords, consent declaration), both signature rows with accept status, and every finished day's entries — collapsed days are temporarily revealed during collection so nothing gets missed. The plain-text export also dropped its Drive links.
- **v2.5 DH (HTML email):** images embedded as compact JPEG/base64 copies so they preview in strict viewers; email slimmed to the main/important content only.

## What's new in this version
- **v2.4 DH (home screen):** the current app version is now shown always on the home screen — a `v2.4 DH ♥` badge sits in the header next to the Soulmate Code wordmark. Tapping it pops a "✨ What's new in v2.4 DH" toast listing the release highlights. The badge text is driven by `APP_VERSION` in `js/app.js`, so bumping that one constant keeps the home screen in sync automatically; add one `WHATS_NEW` line there per release.

A private, password-gated scene contract web app. **All state lives in Supabase cloud** (`contract_state` table) — nothing is saved to localStorage/sessionStorage/IndexedDB.

## Files
- `index.html` — contract page (header now shows the **Soulmate code logo** + cloud-status pill; Day 1 carries **Our love stamp**)
- `css/styles.css` — compact theme, auto-adjusting text boxes, stamp/logo styles
- `js/app.js` — app logic (Accept/Undo everywhere, legacy accept migration, email export with embedded images)
- `js/cloud.js` — Supabase store (fields / accepts / days)
- `js/supabase-config.js` — ← put your Supabase URL + anon key here
- `img/love-stamp.png`, `img/soulmate-logo.png` — local copies of the Drive assets (Drive `/view` links are blocked in browsers/email/print, so they ship in the repo; originals: [love stamp](https://drive.google.com/file/d/1xT4SnUR8dtEHP14MUMFZnYZnumAS96Fw/view?usp=sharing) · [soulmate logo](https://drive.google.com/file/d/17_Wt5nHtKbuDc7DiynDexI-l-GY8RpgS/view?usp=sharing))
- `img/signature-deep.png`, `img/signature-honey.png` — signature images shown on Accept

## Setup
1. Create a Supabase project, paste URL + anon key into `js/supabase-config.js`.
2. Run in the SQL Editor:
```sql
create table if not exists contract_state (k text primary key, v jsonb not null, updated_at timestamptz default now());
alter table contract_state enable row level security;
create policy "contract rw" on contract_state for all using (true) with check (true);
```
3. Host anywhere static (GitHub Pages works). Signatures, fields and AI days sync through the cloud on every device.

## Notes
- Accept → signs as that party; **Signed ✓ · Undo** stays available even inside a finished day (fresh accepts remain locked).
- Text inputs/textareas are compact and auto-grow to their content.
- ✉ Email data → HTML tab is a **full standalone HTML document** with all important data (export time, completed days, signature status per area, every collected field). Images (signatures, love stamp, logo) use **public https links**: `<img src>` via `lh3.googleusercontent.com/d/<ID>=w<h>h<h>` (direct pixels — previews reliably) wrapped in clickable anchors to the Drive `/view` URL, plus visible "View … on Google Drive" text fallbacks. Signed parties show the image inline; awaiting parties get a clickable "sign image" link. Styled professional & romantic: cream/rose palette, Georgia serif, centered card, rose-bordered banner with SOULMATE CODE wordmark & tagline, framed double-rule stamp footer with a love quote. Plain-text export carries the Drive `/view` links and the full Contract Overview data.
- **v2.4 DH:** HTML email images made bullet-proof for previews: each export now embeds the REAL local PNG copies (img/signature-deep.png, img/signature-honey.png, img/love-stamp.png, img/soulmate-logo.png) as base64 data URIs in `<img src>` (with the lh3 Drive link kept in `srcset` and clickable `/view` anchors), so sign, stamp and logo show even when remote images are blocked or the Drive files are not link-shared — plus inline SVG fallbacks via `onerror`. Signature rows ALWAYS render the sign image: if an area's in-app Accept is missing, the row still shows the real sign with "(accept pending)" instead of a blank line.
- **v2.3 DH:** Added inline SVG onerror fallbacks + always-visible italic name text so marks preview in every viewer.
- **v2.2 DH:** HTML email image links fixed for reliable previews: `<img src>` now uses `https://lh3.googleusercontent.com/d/<FILE_ID>=w<h>h<h>` (always serves real image pixels — `uc?export=view` often returns an HTML warning page that breaks previews), and every image is wrapped in a clickable anchor to its `drive.google.com/file/d/<ID>/view` link with a visible "View … on Google Drive" text fallback. The exported HTML also got a more professional & romantic look (rose-bordered header banner, tagline, framed stamp footer with quote) and now includes ALL important contract data — contract no., effective date, printed names, special requests, days covered, safewords, consent declaration, and the do/don't summary — as a "Contract Overview" section. Ensure the four Drive files remain shared as "Anyone with the link — Viewer".
- **v2.1 DH:** HTML email switched from base64 data URIs to https image links — data URIs were blocked by HTML-preview tools and many email clients, so signatures/stamp/logo now preview properly after copying the code.
- **v2.0 DH:** Marking a day *finished* seals it **and collapses it automatically**; every day has a ▾ Collapse / ▸ Expand toggle (works for AI-created days too). Collapsed days still print/export in full (print CSS overrides collapse).
- **v2.0 DH:** Header shows the Soulmate code logo enlarged (220×220, was 88×88) with a bigger "SOULMATE CODE" wordmark beneath it.
