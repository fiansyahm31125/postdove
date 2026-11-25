# Postdove

API client desktop untuk menyusun, mengirim, dan memeriksa request HTTP.
Postdove memakai antarmuka Precision Slate dari Postdove Web, dibundle dengan Vite 6
dan dijalankan melalui Tauri v2. Rust dan Tokio menangani request HTTP, sandbox
lokal, dan penyimpanan workspace.

## Menjalankan

Siapkan Node.js, Rust, dan dependensi sistem sesuai [panduan Tauri](https://v2.tauri.app/start/prerequisites/).
Windows menggunakan Microsoft Edge WebView2. Linux menggunakan WebKitGTK 4.1.

```powershell
npm ci
npm run tauri dev
```

Untuk membuat paket desktop sesuai platform, jalankan `npm run tauri build`.
Pada pembukaan pertama, data workspace lama dari Tauri atau eframe diimpor
ke tampilan ini. Perubahan berikutnya disimpan ke `studio-workspace.json`
di direktori data aplikasi Tauri.

## Penggunaan

1. Pilih metode HTTP dan isi URL lengkap. Tambahkan query parameter langsung di URL.
2. Isi kolom **Name** dan **Value** di **Headers**. Untuk JSON, gunakan
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
npm run build
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

## Import dan export koleksi

- Pilih **Import Postman collection** di sidebar lalu buka JSON Postman Collection v2.1.
  Hasil impor muncul sebagai koleksi baru. Request dengan URL string atau
  `url.raw` dapat diimpor.
- Pilih koleksi lalu klik **Export Postman collection** untuk menyimpan file
  `.postman_collection.json`.
- Skrip dan contoh respons dari file impor dipertahankan saat ekspor ulang.
  Eksekusi request di Postdove menggunakan header dan raw body. Skrip Postman,
  auth Postman, environment Postdove, dan tes status Postdove tidak dikonversi
  menjadi perilaku yang setara di aplikasi tujuan. Token Bearer yang diisi
  sebagai field sesi Postdove tidak diekspor.

## Berbagi workspace melalui LAN

1. Di Postdove pada PC induk, buka **LAN Sharing** di status bar. Pilih alamat
   IP privat PC itu beserta port, lalu klik **Start sharing**. Untuk mencoba
   di PC yang sama, gunakan `127.0.0.1:46329`.
2. Berikan undangan dan PIN kepada viewer melalui saluran tepercaya. Pada
   viewer, tempel undangan, cocokkan fingerprint SHA-256 dengan layar induk,
   lalu masukkan PIN dan pilih **Pair & open**.
3. Viewer memakai **Open shared workspace** untuk membaca snapshot terbaru.
   PC induk tetap mengelola koleksi melalui Workbench. Viewer hanya melihat
   nama koleksi, nama request, metode, URL tanpa kredensial atau nilai query,
   serta nama header dan parameter.

Postdove membuat identitas TLS self-signed saat pertama dibuka. Pairing
menggunakan TLS 1.3 dan PIN sekali pakai yang berlaku dua menit dengan maksimal
lima percobaan. Koneksi berikutnya memverifikasi sertifikat induk yang dipin
dan memakai token yang terikat ke fingerprint sertifikat viewer. Verifikasi
fingerprint saat pairing pertama mengautentikasi induk tanpa memasang
sertifikat ke penyimpanan kepercayaan OS.

**Stop sharing** menutup listener. Pairing tetap berlaku saat host diaktifkan
kembali dengan alamat yang sama. Gunakan **Revoke** di induk untuk mencabut
semua pairing, atau **Forget host** di viewer untuk melupakan induk di PC itu.
Apabila firewall Windows meminta izin, LAN Sharing menggunakan profil jaringan
privat dan port yang ditampilkan.
