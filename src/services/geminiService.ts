import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function generateMaintenanceReport(results: any, pointSelect: string, currentLevel: number, threshold: number, lang: 'id' | 'en' = 'id') {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  
  const prompt = `
    As an Expert Maintenance Engineer, ${lang === 'id' ? 'buatlah laporan teknis singkat dalam Bahasa Indonesia' : 'generate a concise technical report in English'} based on the following data:
    - ${lang === 'id' ? 'Mesin/Bearing' : 'Machine/Bearing'}: ${pointSelect}
    - ${lang === 'id' ? 'Mode Analitik' : 'Analytic Mode'}: ${results.mode} (Hybrid Piecewise Algorithm)
    - ${lang === 'id' ? 'Operational Risk Level' : 'Operational Risk Level'}: ${results.riskLevel}
    - ${lang === 'id' ? 'Model Confidence/Stability' : 'Model Confidence/Stability'}: ${results.confidenceScore}%
    - ${lang === 'id' ? 'Status Kesehatan' : 'Health Status'}: ${results.status}
    - ${lang === 'id' ? 'Rata-rata Vibrasi (Current HI)' : 'Average Vibration (Current HI)'}: ${currentLevel.toFixed(2)} mm/s
    - ${lang === 'id' ? 'Estimasi Sisa Umur (RUL)' : 'Estimated Remaining Useful Life (RUL)'}: ${results.mode === 'HDR' ? results.rulDays.toFixed(2) + (lang === 'id' ? " hari" : " days") : (lang === 'id' ? "> 3 Tahun (Healthy Phase)" : "> 3 Years (Healthy Phase)")}
    - ${lang === 'id' ? 'Uncertainty Range' : 'Uncertainty Range'}: ${results.confidenceInterval ? results.confidenceInterval[0].toFixed(1) + (lang === 'id' ? " hingga " : " to ") + results.confidenceInterval[1].toFixed(1) + (lang === 'id' ? " hari" : " days") : "N/A (LDR Phase)"}
    - ${lang === 'id' ? 'Prediksi Tanggal Kerusakan' : 'Predicted Failure Date'}: ${results.mode === 'HDR' ? results.failureDate.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : "N/A"}
    - ${lang === 'id' ? 'Ambang Batas (Threshold)' : 'Threshold'}: ${threshold} mm/s

    Provide specific ${lang === 'id' ? 'rekomendasi tindakan perawatan (Maintenance Recommendation)' : 'Maintenance Recommendations'} for field technicians. 
    If in LDR (Low Degradation) mode, focus on routine maintenance and cost efficiency. 
    If in HDR (High Degradation) mode, provide critical preemptive and scheduled replacement instructions.
    Use a professional, authoritative, and technical tone. Output ONLY the report text in ${lang === 'id' ? 'Indonesian' : 'English'}.
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
