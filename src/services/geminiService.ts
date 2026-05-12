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
    - Mode Analitik: ${results.mode} (Hybrid Piecewise Algorithm)
    - Operational Risk Level: ${results.riskLevel}
    - Model Confidence/Stability: ${results.confidenceScore}%
    - Status Kesehatan: ${results.status}
    - Rata-rata Vibrasi (Current HI): ${currentLevel.toFixed(2)} mm/s
    - Estimasi Sisa Umur (RUL): ${results.mode === 'HDR' ? results.rulDays.toFixed(2) + " hari" : "> 3 Tahun (Healthy Phase)"}
    - Uncertainty Range: ${results.confidenceInterval ? results.confidenceInterval[0].toFixed(1) + " hingga " + results.confidenceInterval[1].toFixed(1) + " hari" : "N/A (LDR Phase)"}
    - Prediksi Tanggal Kerusakan: ${results.mode === 'HDR' ? results.failureDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : "N/A"}
    - Ambang Batas (Threshold): ${threshold} mm/s

    Berikan rekomendasi tindakan perawatan (Maintenance Recommendation) yang spesifik 
    untuk teknisi di lapangan. Jika dalam mode LDR (Low Degradation), fokuslah pada pemeliharaan rutin dan penghematan biaya. Jika dalam mode HDR (High Degradation), berikan instruksi kritis untuk preventif dan penggantian komponen yang terjadwal.
    Gunakan nada profesional, otoritatif, dan teknis.
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
