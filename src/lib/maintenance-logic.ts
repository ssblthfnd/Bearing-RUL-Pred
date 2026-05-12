import { parse, format, differenceInDays, addDays } from 'date-fns';
import * as ss from 'simple-statistics';

export interface RawData {
  Point: string;
  Date: string;
  Time: string;
  Level: string | number;
  Spectral: string;
}

export interface ProcessedData {
  Point: string;
  Datetime: Date;
  TimeNumeric: number;
  Level: number;
  SmoothedLevel: number;
  // Extended Features
  rms: number;
  kurtosis: number;
  envRms: number;
  compositeHI: number;
}

export interface ModelResults {
  rmse: number;
  phScore: number;
  stabilityIndex: number;
  confidenceScore: number;
  confidenceExplanation: string;
  trendDirection: 'Accelerating' | 'Stable Growth' | 'Fluctuating' | 'Steady';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  rulDays: number;
  failureDate: Date;
  testData: ProcessedData[];
  predictions: number[];
  slope: number;
  intercept: number;
  expSlope: number;
  expIntercept: number;
  fptIndex: number | null;
  fptThreshold: number;
  mode: 'LDR' | 'HDR';
  status: 'Healthy' | 'Warning' | 'Danger';
  confidenceInterval?: [number, number];
  validation: {
    actualAtEnd: number;
    predictedAtEnd: number;
    drift: number;
    trendStability: number;
  };
}

// Helper for RMSE
function calculateRMSE(actual: number[], predicted: number[]) {
  if (actual.length === 0) return 0;
  const diffs = actual.map((a, i) => Math.pow(a - (predicted[i] || 0), 2));
  return Math.sqrt(ss.sum(diffs) / diffs.length);
}

export function preprocessData(data: RawData[], pointPrefix: string): ProcessedData[] {
  const filtered = data
    .filter(row => row.Point && row.Point.startsWith(pointPrefix))
    .map(row => {
      const datetimeStr = `${row.Date} ${row.Time}`;
      const dt = parse(datetimeStr, 'dd-MMM-yy HH:mm', new Date());
      return {
        ...row,
        Datetime: dt,
        Level: typeof row.Level === 'string' ? parseFloat(row.Level) : row.Level
      };
    })
    .filter(row => !isNaN(row.Datetime.getTime()) && !isNaN(row.Level));

  if (filtered.length === 0) return [];

  const groupedByTime: { [key: number]: { Datetime: Date, MaxLevel: number } } = {};
  filtered.forEach(item => {
    const ts = item.Datetime.getTime();
    if (!groupedByTime[ts]) {
      groupedByTime[ts] = { Datetime: item.Datetime, MaxLevel: item.Level };
    } else {
      groupedByTime[ts].MaxLevel = Math.max(groupedByTime[ts].MaxLevel, item.Level);
    }
  });

  const uniqueTimestamps = Object.values(groupedByTime).sort((a, b) => a.Datetime.getTime() - b.Datetime.getTime());
  const referenceDate = uniqueTimestamps[0].Datetime;

  // 1. Feature Extraction & Rolling Stats (Input Layer Simulation)
  const features = uniqueTimestamps.map((row, i, arr) => {
    const windowSize = 5;
    const window = arr.slice(Math.max(0, i - windowSize + 1), i + 1).map(r => r.MaxLevel);
    
    // RMS of level (simplified proxy)
    const rms = Math.sqrt(ss.sum(window.map(x => x*x)) / window.length);
    // Kurtosis (proxy)
    let kurt = 0;
    try { kurt = window.length >= 4 ? ss.sampleKurtosis(window) : 0; } catch(e) {}
    // Envelope RMS approximation (simplified as rolling absolute diff)
    const envRms = window.length > 1 ? ss.standardDeviation(window) : 0;

    return {
      Datetime: row.Datetime,
      Level: row.MaxLevel,
      rms,
      kurtosis: isFinite(kurt) ? kurt : 0,
      envRms
    };
  });

  // 2. EWMA Smoothing
  const alpha = 0.3; // Smoothing factor
  let lastEwma = features[0].Level;
  
  const smoothed = features.map((row, i) => {
    const ewma = i === 0 ? row.Level : alpha * row.Level + (1 - alpha) * lastEwma;
    lastEwma = ewma;
    
    // Composite Weighted HI
    // Weighting: 60% Level/RMS, 20% Kurtosis, 20% EnvRMS
    const compositeHI = (0.6 * ewma) + (0.2 * Math.abs(row.kurtosis)) + (0.2 * row.envRms);

    return {
      Point: pointPrefix,
      Datetime: row.Datetime,
      TimeNumeric: (row.Datetime.getTime() - referenceDate.getTime()) / (1000 * 3600 * 24),
      Level: row.Level,
      SmoothedLevel: ewma,
      rms: row.rms,
      kurtosis: row.kurtosis,
      envRms: row.envRms,
      compositeHI
    };
  });

  // 4. Lifecycle Segmentation
  let latestLifecycleStart = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i-1].SmoothedLevel;
    const curr = smoothed[i].SmoothedLevel;
    if ((prev - curr > 1.5 && curr < 1.2) || (prev > curr * 3.3)) {
      latestLifecycleStart = i;
    }
  }

  const latestSegment = smoothed.slice(latestLifecycleStart);
  if (latestSegment.length > 0) {
    const newRef = latestSegment[0].Datetime;
    return latestSegment.map(row => ({
      ...row,
      TimeNumeric: (row.Datetime.getTime() - newRef.getTime()) / (1000 * 3600 * 24),
    }));
  }

  return latestSegment;
}

function getRiskLevel(rul: number, hi: number, threshold: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (rul < 7 || hi > threshold * 0.95) return 'CRITICAL';
  if (rul < 30 || hi > threshold * 0.8) return 'HIGH';
  if (rul < 90 || hi > threshold * 0.6) return 'MEDIUM';
  return 'LOW';
}

function getTrendDirection(data: ProcessedData[]): 'Accelerating' | 'Stable Growth' | 'Fluctuating' | 'Steady' {
  if (data.length < 5) return 'Steady';
  const recent = data.slice(-10);
  const levels = recent.map(d => d.compositeHI);
  const slopes: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    slopes.push(levels[i] - levels[i-1]);
  }
  const avgSlope = ss.mean(slopes);
  const slopeVar = ss.standardDeviation(slopes);

  // If variance is significantly higher than growth, it's fluctuating
  if (slopeVar > Math.abs(avgSlope) * 2 && data.length > 10) return 'Fluctuating';
  
  // Acceleration check (change in slope / second derivative)
  const secondDeriv = [];
  for (let i = 1; i < slopes.length; i++) {
    secondDeriv.push(slopes[i] - slopes[i-1]);
  }
  const avgAccel = ss.mean(secondDeriv);
  
  if (avgAccel > 0.005) return 'Accelerating';
  if (avgSlope > 0.005) return 'Stable Growth';
  return 'Steady';
}

export function processAndModel(data: ProcessedData[], threshold: number, fptConfig: { manualThreshold?: number, multiplier?: number } = { multiplier: 3 }): ModelResults {
  if (data.length < 5) {
    throw new Error("Insufficient data for modeling (need at least 5 points)");
  }

  // 1. Adaptive Baseline Logic
  const baselineSize = Math.max(3, Math.floor(data.length * 0.25));
  const bData = data.slice(0, baselineSize).map(d => d.compositeHI);
  const mu = ss.mean(bData);
  const sigma = ss.standardDeviation(bData);

  // Hybrid thresholds for FPT: Slope change + Z-score + Persistence (Hysteresis)
  const zScoreThreshold = fptConfig.manualThreshold ?? (mu + (fptConfig.multiplier ?? 3) * sigma);
  
  let fptIndex: number | null = null;
  const persistenceFactor = 5; // Stronger persistence window
  const slopeThreshold = 0.04; 

  for (let i = baselineSize; i <= data.length - persistenceFactor; i++) {
    const currentWindow = data.slice(i, i + persistenceFactor);
    const zCheck = currentWindow.every(d => d.compositeHI > zScoreThreshold);
    
    // Check if trend is consistently positive in the window
    const trends = [];
    for(let j = 1; j < currentWindow.length; j++) {
      trends.push(currentWindow[j].compositeHI >= currentWindow[j-1].compositeHI);
    }
    const trendCheck = trends.filter(t => t).length >= persistenceFactor - 2;

    const localSlope = (data[i].compositeHI - data[i-1].compositeHI) / (data[i].TimeNumeric - data[i-1].TimeNumeric || 1);
    const slopeCheck = localSlope > slopeThreshold;

    if (zCheck && slopeCheck && trendCheck) {
      fptIndex = i;
      break;
    }
  }

  const lastPoint = data[data.length - 1];
  const lastTime = lastPoint.TimeNumeric;
  const lastHI = lastPoint.compositeHI;
  const trendDir = getTrendDirection(data);

  // --- LDR: Adaptive Linear ---
  if (fptIndex === null) {
    const linPoints = data.map(d => [d.TimeNumeric, d.compositeHI]);
    const linReg = ss.linearRegression(linPoints);
    const r2 = ss.sampleCorrelation(data.map(d => d.TimeNumeric), data.map(d => d.compositeHI)) ** 2;
    
    let rulDays = 1095;
    if (linReg.m > 0.0001) {
      rulDays = Math.max(0, (threshold - linReg.b) / linReg.m - lastTime);
    }

    return {
      rmse: calculateRMSE(data.map(d => d.compositeHI), data.map(d => linReg.m * d.TimeNumeric + linReg.b)),
      phScore: 0,
      stabilityIndex: Math.max(0.6, r2),
      confidenceScore: Math.round(75 + (r2 * 20)),
      confidenceExplanation: data.length < 15 ? "Koleksi data awal. Model memerlukan lebih banyak sampel untuk meningkatkan presisi." : "Vibrasi stabil di bawah batas FPT. Kondisi mesin terpantau sehat.",
      trendDirection: trendDir,
      riskLevel: getRiskLevel(rulDays, lastHI, threshold),
      rulDays,
      failureDate: addDays(lastPoint.Datetime, Math.round(rulDays)),
      testData: [],
      predictions: [],
      slope: linReg.m,
      intercept: linReg.b,
      expSlope: 0,
      expIntercept: 0,
      fptIndex: null,
      fptThreshold: zScoreThreshold,
      mode: 'LDR',
      status: 'Healthy',
      validation: {
        actualAtEnd: lastHI,
        predictedAtEnd: linReg.m * lastTime + linReg.b,
        drift: lastHI - (linReg.m * lastTime + linReg.b),
        trendStability: r2
      }
    };
  }

  // --- HDR: Exponential + Bayesian Confidence ---
  const hdrData = data.slice(fptIndex);
  const refTime = hdrData[0].TimeNumeric;
  
  const expPoints = hdrData.map(d => [d.TimeNumeric - refTime, Math.log(Math.max(0.1, d.compositeHI))]);
  const expReg = ss.linearRegression(expPoints);
  const r2 = ss.sampleCorrelation(expPoints.map(p => p[0]), expPoints.map(p => p[1])) ** 2;

  const phScore = (lastTime - data[fptIndex].TimeNumeric) / 365.0;

  const targetLog = Math.log(threshold);
  let rulDays = 30;
  if (expReg.m > 0) {
    const daysFromFpt = (targetLog - expReg.b) / expReg.m;
    rulDays = Math.max(0, daysFromFpt - (lastTime - refTime));
  }

  const hdrPersistence = hdrData.length / 15;
  const stabilityIndex = Math.min(1, (r2 * 0.7) + (Math.min(1, hdrPersistence) * 0.3));
  const predictions = hdrData.map(d => Math.exp(expReg.m * (d.TimeNumeric - refTime) + expReg.b));
  const rmse = calculateRMSE(hdrData.map(d => d.compositeHI), predictions);

  const spread = (1 - r2) * rulDays * 0.4 + (rmse * 3); 
  const confidenceInterval: [number, number] = [Math.max(0, rulDays - spread), rulDays + spread];
  const confidenceScore = Math.max(15, Math.min(99, Math.round((stabilityIndex * 80) + (Math.min(1, phScore) * 20))));

  let explanation = "";
  if (data.length < 10) {
    explanation = "Data minimal. Tren degradasi belum terkonfirmasi secara statistik.";
  } else if (stabilityIndex < 0.4) {
    explanation = "Rendah: Fluktuasi vibrasi tinggi (noise) menghambat kestabilan prediksi RUL.";
  } else if (hdrPersistence < 0.5) {
    explanation = "Moderat: Degradasi baru dimulai (FPT transisi). Menunggu persistensi trend.";
  } else {
    explanation = "Tinggi: Model mengikuti kurva degradasi eksponensial dengan tingkat error rendah.";
  }

  let status: 'Healthy' | 'Warning' | 'Danger' = 'Warning';
  if (rulDays < 7 || lastHI > threshold * 0.95) status = 'Danger';
  else if (rulDays < 30) status = 'Warning';
  else status = 'Healthy';

  return {
    rmse,
    phScore,
    stabilityIndex,
    confidenceScore,
    confidenceExplanation: explanation,
    trendDirection: trendDir,
    riskLevel: getRiskLevel(rulDays, lastHI, threshold),
    rulDays,
    failureDate: addDays(lastPoint.Datetime, Math.round(rulDays)),
    testData: hdrData,
    predictions,
    slope: 0,
    intercept: 0,
    expSlope: expReg.m,
    expIntercept: expReg.b,
    fptIndex,
    fptThreshold: zScoreThreshold,
    mode: 'HDR',
    status,
    confidenceInterval,
    validation: {
      actualAtEnd: lastHI,
      predictedAtEnd: Math.exp(expReg.m * (lastTime - refTime) + expReg.b),
      drift: lastHI - Math.exp(expReg.m * (lastTime - refTime) + expReg.b),
      trendStability: r2
    }
  };
}

export function generateCSVTemplate(): string {
  const headers = "Point,Date,Time,Level,Spectral\n";
  const rows = [
    "AH,18-Jan-21,10:18,0.88,Vel",
    "AV,18-Jan-21,10:20,0.92,Vel",
    "AA,18-Jan-21,10:22,0.85,Vel",
    "BH,18-Jan-21,10:24,1.20,Vel",
    "BV,18-Jan-21,10:26,1.15,Vel",
    "BA,18-Jan-21,10:28,1.10,Vel"
  ].join("\n");
  return headers + rows;
}
