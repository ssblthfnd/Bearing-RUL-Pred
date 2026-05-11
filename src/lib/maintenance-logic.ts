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
  TimeNumeric: number; // Days from reference
  Level: number;
  SmoothedLevel: number;
}

export interface ModelResults {
  rmse: number;
  rulDays: number;
  failureDate: Date;
  testData: ProcessedData[];
  predictions: number[];
  slope: number;
  intercept: number;
  expSlope: number;
  expIntercept: number;
}

export function preprocessData(data: RawData[], pointPrefix: string): ProcessedData[] {
  // 1. Filter by point prefix
  const filtered = data.filter(row => row.Point.startsWith(pointPrefix));

  // 2. Parse Datetime and combine
  let processed = filtered.map(row => {
    // Expected format: Date: 18-Jan-21, Time: 10:18
    const datetimeStr = `${row.Date} ${row.Time}`;
    // Simple parse (assuming DD-MMM-YY)
    // Note: JS Date doesn't always handle DD-MMM-YY well, we might need a more robust parser
    // Let's try simple parsing but be careful
    const dt = parse(datetimeStr, 'dd-MMM-yy HH:mm', new Date());
    
    return {
      Point: row.Point,
      Datetime: dt,
      Level: typeof row.Level === 'string' ? parseFloat(row.Level) : row.Level,
    };
  }).filter(row => !isNaN(row.Datetime.getTime()) && !isNaN(row.Level));

  // Sort by datetime
  processed.sort((a, b) => a.Datetime.getTime() - b.Datetime.getTime());

  if (processed.length === 0) return [];

  const referenceDate = processed[0].Datetime;

  // Calculate TimeNumeric (days from first point)
  const withTime = processed.map(row => ({
    ...row,
    TimeNumeric: (row.Datetime.getTime() - referenceDate.getTime()) / (1000 * 3600 * 24),
  }));

  // 3. Moving Average (N=5)
  // MATLAB movmean(v, 5) with centered window
  const smoothed = withTime.map((row, i, arr) => {
    const window = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
    const sum = window.reduce((acc, r) => acc + r.Level, 0);
    return {
      ...row,
      SmoothedLevel: sum / window.length,
    };
  });

  return smoothed;
}

export function trainModel(data: ProcessedData[], threshold: number): ModelResults {
  const splitIdx = Math.floor(data.length * 0.8);
  const trainData = data.slice(0, splitIdx);
  const testData = data.slice(splitIdx);

  // --- Linear Regression for HI ---
  // MATLAB fitlm
  const points = trainData.map(d => [d.TimeNumeric, d.SmoothedLevel]);
  const regression = ss.linearRegression(points);
  const line = ss.linearRegressionLine(regression);

  const predictions = testData.map(d => line(d.TimeNumeric));
  
  // RMSE
  const errors = testData.map((d, i) => Math.pow(d.SmoothedLevel - predictions[i], 2));
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b, 0) / errors.length);

  // --- Exponential Degradation ---
  // MATLAB polyfit(time, log(level), 1)
  // We use SmoothedLevel as proxy for HI
  const expPoints = trainData.map(d => [d.TimeNumeric, Math.log(Math.max(1e-9, d.SmoothedLevel))]);
  const expRegression = ss.linearRegression(expPoints);
  
  // Formula requested: RUL = abs(intercept / slope)
  // Note: in log-linear, slope is 'b' and intercept is 'ln(a)' in y = a * exp(b*x)
  const slope = expRegression.m;
  const intercept = expRegression.b;

  const rulDays = Math.abs(intercept / (slope === 0 ? 1e-9 : slope));

  const lastDate = data[data.length - 1].Datetime;
  const failureDate = addDays(lastDate, rulDays);

  return {
    rmse,
    rulDays,
    failureDate,
    testData,
    predictions,
    slope: regression.m,
    intercept: regression.b,
    expSlope: slope,
    expIntercept: intercept
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
