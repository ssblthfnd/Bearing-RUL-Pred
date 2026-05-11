import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function generateMaintenanceReport(results: any, pointSelect: string, currentLevel: number, threshold: number) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  
  const prompt = `
    Sebagai Expert Maintenance Engineer, buatlah laporan teknis singkat dalam Bahasa Indonesia berdasarkan data berikut:
    - Mesin/Bearing: Kategori ${pointSelect}
    - Rata-rata Vibrasi Saat Ini: ${currentLevel.toFixed(2)} mm/s
    - RMSE Model: ${results.rmse.toFixed(4)}
    - Estimasi Sisa Umur (RUL): ${results.rulDays.toFixed(2)} hari
    - Prediksi Tanggal Kerusakan: ${results.failureDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
    - Ambang Batas (Threshold): ${threshold} mm/s

    Berikan rekomendasi tindakan perawatan (Maintenance Recommendation) yang spesifik 
    untuk teknisi di lapangan agar menghindari breakdown. Gunakan nada profesional dan teknis.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}
