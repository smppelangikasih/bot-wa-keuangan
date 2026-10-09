import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const GAS_URL = process.env.GAS_URL;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => res.send('Server Bot Keuangan Sekolah Aktif!'));
app.get('/webhook', (req, res) => res.send('Endpoint Webhook Ready!'));
app.get('/api/webhook', (req, res) => res.send('Endpoint API Webhook Ready!'));

const handleWebhook = async (req, res) => {
  try {
    const body = req.body;
    console.log('--- PAYLOAD MASUK DARI FONNTE ---');
    console.log(JSON.stringify(body, null, 2));

    const sender = body.sender || body.pengirim;
    // Ambil URL media dari parameter standar Fonnte (url, file, atau media)
    const mediaUrl = body.url || body.file || body.media;

    if (mediaUrl && mediaUrl !== "" && mediaUrl !== "non-text message") {
      console.log(`[PROSES] Foto nota terdeteksi! URL: ${mediaUrl}`);

      // 1. Unduh gambar dari URL media Fonnte
      const imageDownload = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageDownload.data);
      const mimeType = imageDownload.headers['content-type'] || 'image/jpeg';

      // 2. Ekstraksi dengan Gemini API
      console.log('[PROSES] Memanggil Gemini API...');
      const geminiResult = await scanNotaWithGemini(imageBuffer, mimeType);
      console.log('[SUKSES] Hasil Gemini:', geminiResult);

      // 3. Kirim ke Google Apps Script
      if (GAS_URL) {
        console.log('[PROSES] Mengirim data ke Google Apps Script...');
        await axios.post(GAS_URL, {
          tanggal: geminiResult.tanggal,
          nominal: geminiResult.total_belanja,
          toko: geminiResult.toko,
          jenis: 'Pengeluaran',
          tipe: 'Pengeluaran',
          keterangan: `Nota ${geminiResult.toko || 'Toko'} (${geminiResult.items && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : 'Belanja'})`
        });
      }

      // 4. Balas ke WhatsApp via Fonnte
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
        console.log('[SUKSES] Pesan konfirmasi terkirim ke WhatsApp!');
      }
    } else {
      console.log('[INFO] Pesan yang masuk tidak berisi URL gambar/media.');
    }

    return res.status(200).json({ status: true, message: 'Processed successfully' });

  } catch (err) {
    console.error('[ERROR] Terjadi kesalahan pada Webhook:', err.message);
    return res.status(500).json({ status: false, error: err.message });
  }
};

app.post('/webhook', handleWebhook);
app.post('/api/webhook', handleWebhook);

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

async function kirimPesanFonnte(target, text) {
  await axios.post(
    'https://api.fonnte.com/send',
    { target: target, message: text },
    { headers: { Authorization: FONNTE_TOKEN } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

export default app;
