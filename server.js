import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment Variables dari Vercel
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const GAS_URL = process.env.GAS_URL;

// Inisialisasi SDK Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Route GET untuk tes koneksi (Mencegah error 404 saat Fonnte/Browser ping)
app.get('/', (req, res) => res.send('Server Bot Keuangan Sekolah Aktif!'));
app.get('/webhook', (req, res) => res.send('Endpoint Webhook Ready!'));
app.get('/api/webhook', (req, res) => res.send('Endpoint API Webhook Ready!'));

// Core Handler Webhook
const handleWebhook = async (req, res) => {
  try {
    const { sender, message, pesan, id } = req.body;
    console.log('Webhook Data Received:', JSON.stringify(req.body));

    // Cek URL dari body, jika kosong tapi ada ID pesan, ambil URL dari API Fonnte
    let mediaUrl = req.body.url || req.body.file || req.body.media;

    // Jika Fonnte tidak mengirim URL di webhook, kita panggil API Fonnte untuk ambil detail media
    if (!mediaUrl && id && FONNTE_TOKEN) {
      try {
        const getMediaResponse = await axios.post(
          'https://api.fonnte.com/get-media',
          { id: id },
          { headers: { Authorization: FONNTE_TOKEN } }
        );
        if (getMediaResponse.data && getMediaResponse.data.url) {
          mediaUrl = getMediaResponse.data.url;
        }
      } catch (mediaErr) {
        console.log('Gagal mengambil media dari API Fonnte:', mediaErr.message);
      }
    }

    if (mediaUrl && mediaUrl !== "" && mediaUrl !== "non-text message") {
      console.log(`Foto nota diterima dari nomor: ${sender} | URL: ${mediaUrl}`);

      // 1. Unduh gambar
      const imageDownload = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageDownload.data);
      const mimeType = imageDownload.headers['content-type'] || 'image/jpeg';

      // 2. Ekstraksi Gemini
      console.log('Memproses gambar nota dengan Gemini API...');
      const geminiResult = await scanNotaWithGemini(imageBuffer, mimeType);

      // 3. Kirim ke GAS
      if (GAS_URL) {
        await axios.post(GAS_URL, {
          tanggal: geminiResult.tanggal,
          nominal: geminiResult.total_belanja,
          toko: geminiResult.toko,
          jenis: 'Pengeluaran',
          tipe: 'Pengeluaran',
          keterangan: `Nota ${geminiResult.toko || 'Toko'} (${geminiResult.items && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : 'Belanja'})`
        });
      }

      // 4. Balas ke WA
      if (FONNTE_TOKEN) {
        const formattedNominal = Number(geminiResult.total_belanja || 0).toLocaleString('id-ID');
        const itemsList = Array.isArray(geminiResult.items) && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : '-';
        const pesanBalasan = `✅ *Nota Berhasil Dicatat!*\n\n• *Toko*: ${geminiResult.toko || '-'}\n• *Tanggal*: ${geminiResult.tanggal || '-'}\n• *Total*: Rp${formattedNominal}\n• *Detail*: ${itemsList}`;
        await kirimPesanFonnte(sender, pesanBalasan);
      }
    } else {
      console.log('Pesan bukan berupa media gambar yang dapat diunduh.');
    }

    return res.status(200).json({ status: true, message: 'Processed successfully' });
  } catch (err) {
    console.error('Terjadi kesalahan pada Webhook:', err.message);
    return res.status(500).json({ status: false, error: err.message });
  }
};

// Daftarkan endpoint POST untuk kedua opsi URL
app.post('/webhook', handleWebhook);
app.post('/api/webhook', handleWebhook);

// Fungsi Analisis Gambar dengan Gemini
async function scanNotaWithGemini(buffer, mimeType) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Analisis foto nota ini. Ekstrak data dalam format JSON murni dengan struktur berikut:
  {
    "toko": "Nama Toko / Vendor",
    "tanggal": "YYYY-MM-DD",
    "total_belanja": 10000,
    "items": ["Barang 1", "Barang 2"]
  }`;

  const imagePart = {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: mimeType
    }
  };

  const result = await model.generateContent([prompt, imagePart]);
  return JSON.parse(result.response.text());
}

// Fungsi Kirim Pesan via Fonnte
async function kirimPesanFonnte(target, text) {
  await axios.post(
    'https://api.fonnte.com/send',
    { target: target, message: text },
    { headers: { Authorization: FONNTE_TOKEN } }
  );
}

// Port Handler
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

export default app;
