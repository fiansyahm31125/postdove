# Postdove

API client desktop untuk menyusun, mengirim, dan memeriksa request HTTP.
Aplikasi ditulis dalam Rust dengan eframe/egui dan reqwest.

## Menjalankan

Dari folder proyek dengan toolchain Rust terpasang:

```powershell
cargo run --locked
```

Untuk build release Windows, jalankan `cargo build --release --locked`.
Executable tersedia di `target\release\postdove.exe`.

## Penggunaan

1. Pilih metode HTTP dan isi URL lengkap. Tambahkan query parameter langsung di URL.
2. Isi **Headers** dengan satu pasangan nama dan nilai per baris. Untuk JSON, gunakan
   `Content-Type: application/json` dan masukkan payload di **Body**.
3. Bila diperlukan, masukkan token di **Auth**. Klik **Send** atau tekan Ctrl+Enter.
4. Panel **Response** menampilkan status, durasi, ukuran, dan header atau body.
   JSON yang valid ditampilkan dengan indentasi.
5. Beri nama request dan klik **Save** untuk menggunakannya kembali setelah aplikasi
   dibuka ulang. **Session history** menyimpan hingga 30 request selama aplikasi berjalan.

Respons dibatasi hingga 1 MiB, request memiliki batas waktu 30 detik, dan redirect
ditampilkan sebagai respons HTTP. Kolom bearer dikecualikan dari penyimpanan.
URL, header manual, dan body dari request yang disimpan tersimpan sebagai teks lokal.

## Tes

```powershell
cargo test --locked
```

## MCP server

Postdove menyediakan server MCP lokal melalui stdio sebagai executable terpisah.
Server memakai mesin HTTP yang sama dengan desktop dan berjalan tanpa membuka jendela.
Workspace desktop dan riwayat sesi tetap di aplikasi desktop.

Build server dari folder proyek:

```powershell
cargo build --locked --bin postdove-mcp
```

Contoh konfigurasi TOML untuk Codex. Ganti path jika lokasi repo berbeda:

```toml
[mcp_servers.postdove]
command = 'D:\github\postdove\target\debug\postdove-mcp.exe'
```

Tool `send_http_request` menerima `url` serta opsi `method` (default GET),
`headers`, `body`, dan `bearer`. Hasil terstruktur memuat `status`,
`elapsedMs`, `headers`, `body`, `bytes`, dan `truncated`.

Contoh argumen tool:

```json
{"url":"http://127.0.0.1:8080/health","method":"GET"}
```
