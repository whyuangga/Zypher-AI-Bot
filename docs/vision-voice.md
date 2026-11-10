# 🖼️🎙️ Vision (gambar) & voice (suara)

Dua fitur yang membuat room AI tidak cuma menerima teks:

1. **Vision** — member mengirim gambar, AI membacanya (butuh model multimodal).
2. **Voice** — member mengirim voice note, AI transkrip (STT) lalu bisa membalas dengan suara (TTS).

Keduanya opsional dan mati secara default, karena butuh model/kuota tambahan di provider.

---

## Vision: AI membaca gambar

```env
VISION_ENABLED=true
VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct   # default, tersedia di Groq
VISION_MAX_MB=5
```

Alur:

1. Member kirim gambar (JPG/PNG/WebP/GIF) di room AI — boleh disertai teks pertanyaan.
2. Bot mengunduh maksimal **3 gambar** per pesan, dicek ukurannya (`VISION_MAX_MB`).
3. Gambar diubah jadi **data URI base64** lalu dimasukkan ke pesan dengan format
   `image_url` (protokol OpenAI-compatible) — tidak perlu upload ke storage mana pun.
4. Model vision menjawab; tanpa teks dari member, pertanyaannya otomatis
   “Jelaskan isi gambar ini secara detail.”

Catatan penting:

- **Model teks biasa tidak bisa melihat gambar.** Saat ada gambar, bot **memaksa**
  model menjadi `VISION_MODEL` dan mematikan *tool calling* (memori otomatis) untuk
  request itu, karena model vision umumnya belum mendukung function calling.
- Kalau provider utama bukan Groq, ganti `VISION_MODEL` sesuai model multimodal provider
  tersebut (mis. `gpt-4o-mini` di OpenAI). Fallback chain tetap dipakai, jadi model harus
  dikenali provider cadangan juga.
- Gambar terlalu besar atau gagal diunduh **dilewati**, bukan menggagalkan jawaban —
  bot akan memberi ringkasan singkat tentang lampiran yang dilewati.
- Riwayat percakapan tetap menyimpan teks saja; gambar tidak disimpan di database.

Dukungan format lain (PDF/DOCX) tetap lewat RAG: gunakan `/dokumen tambah` atau dashboard,
bukan lampiran chat.

---

## Voice: transkrip & balasan suara

```env
VOICE_ENABLED=true
STT_MODEL=whisper-large-v3
TTS_ENABLED=true
TTS_MODEL=playai-tts
TTS_VOICE=Fritz-PlayAI
VOICE_MAX_MB=20
```

Endpoint yang dipakai (OpenAI-compatible, sama dengan provider chat):

| Fitur | Endpoint | Default model |
|---|---|---|
| Transkrip (STT) | `POST /audio/transcriptions` (multipart) | `whisper-large-v3` |
| Balasan suara (TTS) | `POST /audio/speech` (JSON) | `playai-tts` |

Alur voice note:

1. Member kirim voice note (`voice-message.ogg`) atau file audio (`.mp3`, `.m4a`, `.wav`,
   `.webm`, `.flac`) di room AI.
2. Bot mengunduh audio (maks `VOICE_MAX_MB`), lalu minta transkrip ke provider.
3. Transkrip dipakai sebagai pertanyaan → AI menjawab dengan teks seperti biasa.
4. Kalau `TTS_ENABLED=true`, bot mengirim **tambahan** pesan berisi file audio jawaban
   (`jawaban.mp3`, atau `.wav` bila provider menolak mp3). Jawaban teks tetap ada, jadi
   percakapan tetap terbaca.

Kalau transkrip gagal (kuota habis, format ditolak, file rusak), member melihat alasan
singkatnya dan percakapan tetap bisa lanjut dengan teks.

### `/ucap` — teks jadi suara

```
/ucap teks:Selamat pagi semuanya, event dimulai jam 8 malam ya
```

Bot membalas (ephemeral) dengan lampiran audio. Cocok untuk menguji kualitas suara,
membuat pengumuman, atau kebutuhan aksesibilitas.

Ganti suara lewat `TTS_VOICE`. Di Groq (PlayAI) contohnya `Fritz-PlayAI` (pria),
`Celeste-PlayAI` (wanita). Cek [docs/models.md](models.md) untuk model yang tersedia.

---

## Biaya & batas gratis

| Provider | STT | TTS | Vision |
|---|---|---|---|
| Groq (default) | `whisper-large-v3` — ada kuota gratis harian | `playai-tts` — kuota lebih kecil | `llama-4-scout` — gratis terbatas |
| OpenAI | `whisper-1` — berbayar | `tts-1` — berbayar | `gpt-4o-mini` — berbayar |

> Kalau kuota suara habis, matikan `VOICE_ENABLED`/`TTS_ENABLED` — fitur teks tidak
> terpengaruh sama sekali.

---

## Menyalakan di dashboard?

Belum — pengaturan vision/voice masih lewat `.env`. Moderasi sudah punya halaman
sendiri di `/moderasi`.
