import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GAS_URL = process.env.GAS_URL;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

app.get('/', (req, res) => res.send('Server Bot Telegram Keuangan Sekolah Aktif!'));
app.get('/webhook', (req, res) => res.send('Endpoint Webhook Ready!'));

app.post(['/webhook', '/api/webhook'], async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) return res.status(200).send('OK');

    const chatId = message.chat.id;

    // Cek apakah pesan berisi foto
    if (message.photo && message.photo.length > 0) {
      console.log(`[PROSES] Foto nota diterima dari Chat ID: ${chatId}`);

      // 1. Ambil foto dengan resolusi tertinggi (elemen terakhir dalam array photo)
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;

      // 2. Dapatkan file_path dari Telegram API
      const fileRes = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const filePath = fileRes.data.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;

      // 3. Unduh gambar ke buffer
      const imageDownload = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageDownload.data);
      const mimeType = 'image/jpeg';

      // 4. Ekstraksi dengan Gemini API
      console.log('[PROSES] Memanggil Gemini API...');
      const geminiResult = await scanNotaWithGemini(imageBuffer, mimeType);
      console.log('[SUKSES] Hasil Gemini:', geminiResult);

      // 5. Kirim data ke Google Apps Script
      if (GAS_URL) {
        console.log('[PROSES] Menyimpan ke Google Sheets...');
        await axios.post(GAS_URL, {
          tanggal: geminiResult.tanggal,
          nominal: geminiResult.total_belanja,
          toko: geminiResult.toko,
          jenis: 'Pengeluaran',
          tipe: 'Pengeluaran',
          keterangan: `Nota ${geminiResult.toko || 'Toko'} (${geminiResult.items && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : 'Belanja'})`
        });
      }

      // 6. Balas pesan ke Telegram
      const formattedNominal = Number(geminiResult.total_belanja || 0).toLocaleString('id-ID');
      const itemsList = Array.isArray(geminiResult.items) && geminiResult.items.length > 0 ? geminiResult.items.join(', ') : '-';

      const pesanBalasan = `✅ *Nota Berhasil Dicatat!*\n\n` +
        `• *Toko*: ${geminiResult.toko || '-'}\n` +
        `• *Tanggal*: ${geminiResult.tanggal || '-'}\n` +
        `• *Total*: Rp${formattedNominal}\n` +
        `• *Detail*: ${itemsList}`;

      await kirimPesanTelegram(chatId, pesanBalasan);
      console.log('[SUKSES] Konfirmasi terkirim ke Telegram!');
    } else {
      await kirimPesanTelegram(chatId, 'Silakan kirimkan foto/gambar nota belanja untuk dicatat.');
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[ERROR] Terjadi kesalahan:', err.message);
    return res.status(200).send('OK');
  }
});

async function scanNotaWithGemini(buffer, mimeType) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
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

async function kirimPesanTelegram(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

export default app;
