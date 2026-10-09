import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variabel Lingkungan dari Vercel
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const GAS_URL = process.env.GAS_URL;

// Inisialisasi SDK Gemini API Resmi
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Handler GET (Mencegah error 404 saat Fonnte melakukan ping/tes koneksi)
app.get('/', (req, res) => {
  res.send('Server Bot Keuangan Sekolah Aktif!');
});

app.get('/webhook', (req, res) => {
  res.send('Endpoint Webhook Ready!');
});

// Webhook Endpoint Utama Penerima Pesan Fonnte (POST)
app.post('/webhook', async (req, res) => {
  try {
    const { sender, url, type } = req.body;
    console.log('Webhook dipanggil oleh Fonnte:', JSON.stringify(req.body));

    // Cek jika ada media gambar yang dikirim dari Fonnte
    const mediaUrl = url || req.body.file || req.body.media;
    const isImage = (type === 'image') || (mediaUrl && mediaUrl.match(/\.(jpeg|jpg|png|webp)/i)) || req.body.file;

    if (mediaUrl && isImage) {
      console.log(`Foto nota diterima dari nomor: ${sender}`);

      // 1. Unduh gambar dari Fonnte
      const imageDownload = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageDownload.data);
      const mimeType = imageDownload.headers['content-type'] || 'image/jpeg';

      // 2. Ekstraksi data nota menggunakan Gemini API
      console.log('Memproses gambar nota dengan Gemini API...');
      const geminiResult = await scanNotaWithGemini(imageBuffer, mimeType);
      console.log('Hasil Ekstraksi Gemini:', geminiResult);

      // 3. Kirim data ke Google Sheets (Disesuaikan persis dengan fungsi doPost GAS kamu)
      if (GAS_URL) {
        console.log('Mengirim data ke Google Apps Script...');
        const gasPayload = {
          tanggal: geminiResult.tanggal,
          nominal: geminiResult.total_belanja,
          toko: geminiResult.toko,
          jenis: 'Pengeluaran',
          tipe: 'Pengeluaran',
          keterangan: `Nota ${geminiResult.toko || 'Toko'} (${geminiResult.items && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : 'Belanja'})`
        };

        const gasResponse = await axios.post(GAS_URL, gasPayload);
        console.log('Respon dari GAS:', gasResponse.data);
      }

      // 4. Kirim balasan konfirmasi ke WhatsApp via Fonnte
      if (FONNTE_TOKEN) {
        const formattedNominal = Number(geminiResult.total_belanja || 0).toLocaleString('id-ID');
        const itemsList = Array.isArray(geminiResult.items) && geminiResult.items.length > 0 
          ? geminiResult.items.join(', ') 
          : '-';

        const pesanBalasan = `✅ *Nota Berhasil Dicatat!*\n\n` +
          `• *Toko*: ${geminiResult.toko || '-'}\n` +
          `• *Tanggal*: ${geminiResult.tanggal || '-'}\n` +
          `• *Total*: Rp${formattedNominal}\n` +
          `• *Detail*: ${itemsList}`;

        await kirimPesanFonnte(sender, pesanBalasan);
        console.log('Pesan balasan berhasil dikirim ke WhatsApp!');
      }
    } else {
      console.log('Pesan diterima bukan berupa gambar nota.');
    }

    // Kirim respon sukses ke Fonnte setelah seluruh eksekusi selesai
    return res.status(200).json({ status: true, message: 'Processed successfully' });

  } catch (err) {
    console.error('Terjadi kesalahan pada Webhook:', err.message);
    return res.status(500).json({ status: false, error: err.message });
  }
});

// Fungsi Analisis Nota Menggunakan Gemini API
async function scanNotaWithGemini(buffer, mimeType) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Analisis foto nota ini. Ekstrak data dalam format JSON murni dengan properti persis seperti berikut:
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

// Fungsi Pengiriman Pesan Fonnte
async function kirimPesanFonnte(target, text) {
  await axios.post(
    'https://api.fonnte.com/send',
    {
      target: target,
      message: text
    },
    {
      headers: {
        Authorization: FONNTE_TOKEN
      }
    }
  );
}

// Port Handler untuk Local & Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

export default app;
