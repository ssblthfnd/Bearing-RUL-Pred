import React, { useState, useRef } from 'react';
import { FileDown, Upload, Settings, Brain, BarChart3, TrendingUp, AlertTriangle, CheckCircle2, History, ChevronRight, Download, BookOpen, Info, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { format } from 'date-fns';
import { preprocessData, processAndModel, generateCSVTemplate, RawData, ProcessedData, ModelResults } from './lib/maintenance-logic';
import { generateMaintenanceReport } from './services/geminiService';
import { cn } from './lib/utils';

export default function App() {
  const [data, setData] = useState<RawData[]>([]);
  const [availablePoints, setAvailablePoints] = useState<string[]>(['A', 'B', 'C', 'D']);
  const [pointPrefix, setPointPrefix] = useState('A');
  const [threshold, setThreshold] = useState(4.5);
  const [fptMultiplier, setFptMultiplier] = useState(3.0);
  const [processedData, setProcessedData] = useState<ProcessedData[]>([]);
  const [results, setResults] = useState<ModelResults | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleDataParsed = (raw: RawData[]) => {
    // Deteksi Dinamis Bearing: Ambil karakter pertama yang unik dari kolom "Point" (misal: A dari AA, AV, AH)
    const prefixes = [...new Set(raw.map(r => r.Point ? r.Point.charAt(0).toUpperCase() : ''))]
      .filter(p => p && /^[A-Z0-9]$/.test(p))
      .sort();
    
    const finalPoints = prefixes.length > 0 ? prefixes : ['A', 'B', 'C', 'D'];
    setAvailablePoints(finalPoints);
    
    const initialPoint = finalPoints[0];
    setPointPrefix(initialPoint);
    
    setData(raw);
    processAndModelWrapper(raw, initialPoint, threshold, fptMultiplier);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        handleDataParsed(results.data as RawData[]);
      },
      error: (err) => {
        setError("Gagal membaca file CSV: " + err.message);
      },
    });
  };

  const loadBuiltInDataset = () => {
    setError(null);
    fetch('/108-JA.csv')
      .then(response => {
        if (!response.ok) throw new Error("Dataset tidak ditemukan di server.");
        return response.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            handleDataParsed(results.data as RawData[]);
          },
          error: (err) => {
            setError("Gagal memproses dataset bawaan: " + err.message);
          }
        });
      })
      .catch(err => {
        setError("Gagal memuat dataset bawaan: " + err.message);
      });
  };

  const processAndModelWrapper = (rawData: RawData[], prefix: string, thr: number, mult: number) => {
    try {
      const allProcessed = preprocessData(rawData, prefix);
      if (allProcessed.length < 5) {
        setError("Data terlalu sedikit untuk kategori ini (minimal 5 data point).");
        setProcessedData([]);
        setResults(null);
        return;
      }

      setProcessedData(allProcessed); 
      const modelResults = processAndModel(allProcessed, thr, { multiplier: mult });
      setResults(modelResults);
      setError(null);
      setAiReport(null);
    } catch (err) {
      setError("Kesalahan pemrosesan: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleDownloadTemplate = () => {
    const csv = generateCSVTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_maintenance.csv';
    a.click();
  };

  const runAiAnalysis = async () => {
    if (!results || !processedData.length) return;
    setIsGeneratingAi(true);
    try {
      const report = await generateMaintenanceReport(
        results, 
        pointPrefix, 
        processedData[processedData.length - 1].Level,
        threshold
      );
      setAiReport(report || "Gagal menghasilkan laporan.");
    } catch (err) {
      setError("Gagal menggunakan Gemini AI. Pastikan API Key sudah diset di Settings.");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!aiReport || isExporting) return;
    setIsExporting(true);
    
    try {
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      let cursorY = 55;
      let currentPage = 1;

      const addHeader = (pageNum: number) => {
        pdf.setFillColor(15, 23, 42); // slate-900
        pdf.rect(0, 0, pageWidth, 40, 'F');
        
        pdf.setTextColor(45, 212, 191); // accent-teal
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(22);
        pdf.text('SmartPredict Advisory Report', margin, 20);
        
        pdf.setTextColor(148, 163, 184); // slate-400
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.text(`BEARING: ${pointPrefix.toUpperCase()} SERIES | DATE: ${format(new Date(), 'dd MMM yyyy')} | PAGE: ${pageNum}`, margin, 32);
      };

      const addFooter = (pageNum: number) => {
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Sistem Monitoring Prediktif SmartPredict AI | Laporan Otomatis | Halaman ${pageNum}`, margin, pageHeight - 10);
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineWidth(0.1);
        pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
      };

      addHeader(currentPage);

      // Metadata Section
      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, cursorY - 5, contentWidth, 20, 'F');
      
      pdf.setTextColor(51, 65, 85);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text('RINGKASAN STATUS OPERASIONAL:', margin + 5, cursorY + 3);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const statusText = results?.status || 'N/A';
      const rulText = results?.mode === 'LDR' ? '> 3 Tahun' : `${results?.rulDays.toFixed(1)} Hari`;
      pdf.text(`Kesehatan: ${statusText}  |  Estimasi Sisa Umur (RUL): ${rulText}`, margin + 5, cursorY + 10);
      
      cursorY += 35;

      // Content Parsing
      const rawLines = aiReport.split('\n');
      
      for (const line of rawLines) {
        if (!line.trim()) {
          cursorY += 5;
          continue;
        }

        // New Page Check
        if (cursorY > pageHeight - 30) {
          addFooter(currentPage);
          pdf.addPage();
          currentPage++;
          addHeader(currentPage);
          cursorY = 55;
        }

        // Pattern matching for headers
        const isH1 = line.startsWith('# ');
        const isH2 = line.startsWith('## ');
        const isH3 = line.startsWith('### ');

        // Clean EVERYTHING: all markdown markers
        let cleanText = line
          .replace(/^(#+\s+)/, '') // Remove heading hashes
          .replace(/\*\*\*(.*?)\*\*\*/g, '$1') // Bold+Italic
          .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
          .replace(/__(.*?)__/g, '$1') // Underscore Bold
          .replace(/\*(.*?)\*/g, '$1') // Italic
          .replace(/^[-*+]\s+/, '• ') // List bullets
          .replace(/^(\d+)\.\s+/, '$1. ') // Numbered lists
          .trim();

        if (isH1) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(18);
          pdf.setTextColor(15, 23, 42);
          cursorY += 5;
        } else if (isH2) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(15);
          pdf.setTextColor(15, 23, 42);
          cursorY += 4;
        } else if (isH3) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(12);
          pdf.setTextColor(30, 41, 59);
          cursorY += 2;
        } else {
          pdf.setFont('times', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(51, 65, 85);
        }

        const wrappedLines = pdf.splitTextToSize(cleanText, contentWidth);
        pdf.text(wrappedLines, margin, cursorY);
        cursorY += (wrappedLines.length * 6.5) + 2;
      }

      addFooter(currentPage);
      pdf.save(`MAINTENANCE_REPORT_${pointPrefix}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      
    } catch (err) {
      console.error("PDF Export failed:", err);
      setError("Gagal membuat PDF. Coba gunakan browser desktop untuk akurasi terbaik.");
    } finally {
      setIsExporting(false);
    }
  };

  const expData = results ? Array.from({ length: 50 }).map((_, i) => {
    const futureDays = (results.rulDays * 1.2 / 49) * i;
    // Hybrid Mapping: if LDR, flat projection. if HDR, exponential projection
    if (results.mode === 'LDR') {
      const lastLevel = processedData.length > 0 ? processedData[processedData.length - 1].SmoothedLevel : 0;
      return {
        days: futureDays.toFixed(1),
        value: lastLevel
      };
    } else {
      return {
        days: futureDays.toFixed(1),
        value: Math.exp(results.expIntercept + results.expSlope * futureDays)
      };
    }
  }) : [];

  return (
    <div className="min-h-screen bg-brand-bg text-slate-300 font-sans flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-80 bg-sidebar-bg border-r border-slate-800 p-6 flex flex-col gap-8 shadow-2xl relative z-20">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-accent-teal p-2 rounded-lg shadow-[0_0_15px_rgba(45,212,191,0.3)]">
            <TrendingUp className="text-black h-5 w-5" />
          </div>
          <h1 className="font-serif italic text-lg leading-tight text-white tracking-tight">SmartPredict<br /><span className="text-accent-teal/80 text-sm not-italic font-sans font-bold uppercase tracking-widest">Mission Control</span></h1>
        </div>

        <div className="space-y-6 flex-1">
          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <FileDown size={14} className="text-accent-teal" /> Dataset Engine
            </h2>
            <button 
              onClick={handleDownloadTemplate}
              className="w-full bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-medium py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 text-slate-300"
            >
              Download Template CSV
            </button>
            <div className="mt-3 relative">
              <input 
                type="file" 
                id="file-upload" 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".csv"
              />
              <label 
                htmlFor="file-upload"
                className="w-full bg-accent-teal/10 text-accent-teal border border-accent-teal/30 hover:bg-accent-teal/20 text-xs font-bold py-3 rounded-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Upload size={14} /> Upload Measurement
              </label>
            </div>
            <button 
              onClick={loadBuiltInDataset}
              className="w-full mt-3 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-[10px] font-bold py-2 rounded-md transition-all flex items-center justify-center gap-2"
            >
              <History size={12} className="text-accent-teal" /> Gunakan Dataset Bawaan (108-JA)
            </button>
          </section>

          <section className="space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <Settings size={14} className="text-accent-teal" /> Parameters
            </h2>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Select Bearing</label>
              <select 
                value={pointPrefix}
                onChange={(e) => {
                  setPointPrefix(e.target.value);
                  if (data.length > 0) processAndModelWrapper(data, e.target.value, threshold, fptMultiplier);
                }}
                className="w-full mt-1.5 bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:border-accent-teal/50"
              >
                {availablePoints.map(p => (
                  <option key={p} value={p}>Bearing {p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Failure Threshold (mm/s)</label>
              <div className="flex items-center gap-4 mt-1.5">
                <input 
                  type="range" 
                  min="0"
                  max="10"
                  step="0.1"
                  value={threshold}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setThreshold(val);
                    if (data.length > 0) processAndModelWrapper(data, pointPrefix, val, fptMultiplier);
                  }}
                  className="flex-1 accent-accent-teal"
                />
                <span className="text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded border border-slate-700">{threshold.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">FPT Sensitivity (σ)</label>
              <div className="flex items-center gap-4 mt-1.5">
                <input 
                  type="range" 
                  min="1"
                  max="6"
                  step="0.1"
                  value={fptMultiplier}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setFptMultiplier(val);
                    if (data.length > 0) processAndModelWrapper(data, pointPrefix, threshold, val);
                  }}
                  className="flex-1 accent-accent-teal"
                />
                <span className="text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded border border-slate-700">{fptMultiplier.toFixed(1)}</span>
              </div>
              <p className="text-[9px] text-slate-500 mt-1">Mean + N*StdDev baseline threshold.</p>
            </div>
          </section>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800 space-y-4">
          <div className="flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_8px_#2dd4bf]"></div>
             <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">System Status: Normal</span>
          </div>
          <div className="text-[9px] font-mono text-slate-600 uppercase tracking-tighter">
            SCIPY_EXP_REG_01 | 64-BIT PRECISION
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 space-y-8 overflow-y-auto max-h-screen relative z-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-900/40 via-brand-bg to-brand-bg">
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg flex items-center gap-3 backdrop-blur-md"
          >
            <AlertTriangle size={18} />
            {error}
          </motion.div>
        )}

        {!data.length ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-20 opacity-60">
            <div className="bg-slate-900 p-8 rounded-full border border-slate-800 mb-4 inline-block">
              <BarChart3 size={64} className="text-slate-700" />
            </div>
            <h2 className="text-4xl font-serif italic text-white tracking-tight">Maintenance Dashboard</h2>
            <p className="text-slate-400 max-w-sm text-sm">Upload data vibrasi untuk mengaktifkan analisis prediktif eksponensial.</p>
          </div>
        ) : (
          <>
            {/* Header / Nav */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
              <div>
                <h2 className="text-4xl font-serif text-white mb-2">Analysis Dashboard</h2>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <p className="text-slate-500 text-sm">Predictive reporting for <span className="text-accent-teal font-bold">Bearing {pointPrefix}</span></p>
                  <div className="hidden sm:block h-4 w-px bg-slate-800" />
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Last Update:</span>
                    <span className="text-[10px] font-mono text-teal-400 font-bold">
                      {format(processedData[processedData.length - 1].Datetime, 'dd MMM yyyy, HH:mm')}
                    </span>
                  </div>
                </div>
              </div>

              <nav className="flex border-b border-slate-800 w-full md:w-auto">
                {[
                  { id: 'dashboard', label: 'RUL Prediction', icon: TrendingUp },
                  { id: 'overview', label: 'Data Overview', icon: History },
                  { id: 'analysis', label: 'AI Insights', icon: Brain },
                  { id: 'methodology', label: 'Metodologi', icon: BookOpen }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "px-6 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 relative",
                      activeTab === tab.id 
                        ? "border-accent-teal text-white" 
                        : "border-transparent text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <motion.div 
                        layoutId="activeTab"
                        className="absolute inset-0 bg-accent-teal/5 -z-10"
                      />
                    )}
                  </button>
                ))}
              </nav>
            </header>

            <AnimatePresence mode="wait">
              {activeTab === 'overview' && (
                <motion.div 
                  key="overview"
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-slate-900/50 p-7 rounded-2xl border border-slate-800 shadow-sm">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-6 font-mono">Statistical Insight</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { label: 'Samples Collected', value: processedData.length },
                          { label: 'Model Stability', value: `${(results?.stabilityIndex || 0 * 100).toFixed(1)}%` },
                          { label: 'Baseline level', value: `${Math.min(...processedData.map(d => d.Level)).toFixed(2)} mm/s` },
                          { label: 'Current HI', value: `${processedData[processedData.length - 1].compositeHI.toFixed(2)}` }
                        ].map(stat => (
                          <div key={stat.label} className="p-5 bg-card-bg rounded-xl border border-slate-800/50">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{stat.label}</p>
                            <p className="text-xl font-bold font-mono text-white mt-1">{stat.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-7 rounded-2xl border border-slate-800 shadow-sm">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-6 font-mono">Real-time Stream</h3>
                      <div className="max-h-[300px] overflow-auto pr-2">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-slate-900 shadow-sm">
                            <tr className="border-b border-slate-800 text-[9px] font-bold uppercase font-mono text-slate-500">
                              <th className="py-2 pr-4">Point</th>
                              <th className="py-2 pr-4">Timestamp</th>
                              <th className="py-2 pr-4 text-right">Level</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono divide-y divide-slate-800">
                            {processedData.slice().reverse().slice(0, 10).map((row, i) => (
                              <tr key={i} className="hover:bg-accent-teal/[0.03] transition-colors group">
                                <td className="py-3 font-bold text-accent-teal/80">{row.Point}</td>
                                <td className="py-3 text-slate-500 group-hover:text-slate-300 transition-colors">{format(row.Datetime, 'dd-MMM-yy HH:mm')}</td>
                                <td className="py-3 font-bold text-right text-white">{row.Level.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-7 rounded-2xl border border-slate-800 shadow-sm lg:col-span-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-6 font-mono">Input Feature Layer (RMS, Kurtosis, Env RMS)</h3>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={processedData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E293B" />
                            <XAxis dataKey="Datetime" tickFormatter={(val) => format(val, 'dd/MM')} tick={{ fontSize: 9, fill: '#64748B' }} />
                            <YAxis tick={{ fontSize: 9, fill: '#64748B' }} />
                            <Tooltip contentStyle={{ backgroundColor: '#0A0C10', borderColor: '#1E293B' }} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', paddingTop: '10px' }} />
                            <Line type="monotone" dataKey="rms" stroke="#8B5CF6" strokeWidth={1.5} dot={false} name="RMS" />
                            <Line type="monotone" dataKey="kurtosis" stroke="#EC4899" strokeWidth={1.5} dot={false} name="Kurtosis" />
                            <Line type="monotone" dataKey="envRms" stroke="#F59E0B" strokeWidth={1.5} dot={false} name="Env RMS" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'dashboard' && results && (
                <motion.div 
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  {/* Top Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 shadow-xl overflow-hidden relative group">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Operational Risk</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold font-mono tracking-widest uppercase",
                          results.riskLevel === 'CRITICAL' ? "bg-red-500/20 text-red-500" : 
                          results.riskLevel === 'HIGH' ? "bg-amber-500/20 text-amber-500" : 
                          results.riskLevel === 'MEDIUM' ? "bg-yellow-500/20 text-yellow-500" : 
                          "bg-teal-500/20 text-teal-400"
                        )}>
                          {results.riskLevel}
                        </div>
                        <div className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold uppercase flex items-center gap-1",
                          results.trendDirection === 'Accelerating' ? "bg-red-500/10 text-red-400" :
                          results.trendDirection === 'Stable Growth' ? "bg-amber-500/10 text-amber-400" :
                          results.trendDirection === 'Fluctuating' ? "bg-purple-500/10 text-purple-400" :
                          "bg-slate-500/10 text-slate-400"
                        )}>
                          {results.trendDirection === 'Accelerating' ? '↑↑' : results.trendDirection === 'Stable Growth' ? '↑' : results.trendDirection === 'Fluctuating' ? '~' : '→'} {results.trendDirection}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-1">
                        <p className="text-[10px] font-medium text-slate-300">
                          {results.status} Status
                        </p>
                        <p className="text-[9px] text-slate-500 italic uppercase tracking-tighter">Stability: {(results.stabilityIndex * 100).toFixed(0)}%</p>
                      </div>
                    </div>
                    
                    <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden group">
                      <div className={cn(
                        "absolute right-0 top-0 h-full w-1 opacity-50 transition-all group-hover:w-2",
                        results.confidenceScore > 80 ? "bg-teal-500" : (results.confidenceScore > 60 ? "bg-amber-500" : "bg-red-500")
                      )}></div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Confidence Score</p>
                      <div className="flex items-baseline gap-2">
                        <p className={cn(
                          "text-2xl font-bold font-mono tracking-tighter uppercase leading-none",
                          results.confidenceScore > 80 ? "text-teal-400" : (results.confidenceScore > 60 ? "text-amber-400" : "text-red-500")
                        )}>
                          {results.confidenceScore}%
                        </p>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Probabilistic</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <p className="text-[9px] text-slate-400 font-medium leading-tight">
                          {results.confidenceExplanation}
                        </p>
                        <div className="text-[9px] font-mono flex items-center gap-1 opacity-60">
                          <span className="text-slate-500 italic">RMSE:</span>
                          <span className="text-slate-400">{results.rmse.toFixed(3)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Uncertainty Estimation</p>
                      <div className="flex flex-col gap-2">
                        {results.confidenceInterval ? (
                          <div className="flex items-center gap-2">
                            <p className="text-xl font-bold font-mono text-white leading-none">
                              &plusmn; {( (results.confidenceInterval[1] - results.confidenceInterval[0]) / 2).toFixed(1)}
                            </p>
                            <span className="text-[9px] font-mono text-slate-500 uppercase">Days Range</span>
                          </div>
                        ) : (
                          <p className="text-sm font-mono text-slate-500">N/A (LDR Mode)</p>
                        )}
                        <div className="pt-2 border-t border-slate-800/50">
                          <p className="text-[9px] font-bold text-slate-500 uppercase">Prognostic Horizon</p>
                          <p className="text-sm font-bold font-mono text-accent-teal leading-none mt-1">
                            {results.phScore.toFixed(2)} Index
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">RUL Prediction</p>
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col">
                          <p className="text-[9px] text-slate-500 font-bold tracking-wider">Estimated Failure</p>
                          <p className={cn(
                            "text-lg font-bold font-mono leading-none",
                            results.mode === 'LDR' ? "text-teal-400/30" : "text-amber-500"
                          )}>
                            {results.mode === 'LDR' ? "OPERATIONAL SAFE" : format(results.failureDate, 'dd MMM yyyy')}
                          </p>
                        </div>
                        <div className="pt-2 border-t border-slate-800">
                          <p className="text-[9px] font-bold text-slate-500 uppercase">Sisa Umur (RUL)</p>
                          <p className={cn(
                            "text-2xl font-bold font-mono tracking-tighter leading-none mt-1",
                            results.mode === 'LDR' ? "text-teal-400" : (results.status === 'Danger' ? "text-red-500" : "text-white")
                          )}>
                            {results.mode === 'LDR' ? "> 3 THN" : (
                              <span>
                                {results.rulDays.toFixed(1)} <span className="text-xs">&plusmn; {((results.confidenceInterval![1] - results.confidenceInterval![0]) / 2).toFixed(0)}</span>
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Charts Grid */}
                  <div className="grid grid-cols-1 gap-8">
                    {/* Main Analysis Plot */}
                    <div className="bg-card-bg p-8 rounded-3xl border border-slate-800 shadow-2xl">
                      <div className="flex items-center justify-between mb-10">
                        <div className="flex items-center gap-3">
                           <div className="h-8 w-1 bg-accent-teal rounded-full" />
                           <div>
                            <h3 className="font-bold text-xl text-white tracking-tight">Exponential Degradation Curve</h3>
                            <p className="text-[11px] text-slate-500 font-mono mt-1">LOG_FIT_SCALING: mm/s vs TIMESTAMP</p>
                           </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-4 bg-accent-teal rounded-full" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Smoothed</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-4 bg-red-500 rounded-full" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Limit</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={processedData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#1E293B" />
                            <XAxis 
                              dataKey="Datetime" 
                              tickFormatter={(val) => format(val, 'dd MMM')} 
                              tick={{ fontSize: 10, fontFamily: 'monospace', fill: '#64748B' }}
                              axisLine={{ stroke: '#1E293B' }}
                              tickLine={false}
                            />
                            <YAxis 
                              tick={{ fontSize: 10, fontFamily: 'monospace', fill: '#64748B' }} 
                              axisLine={{ stroke: '#1E293B' }}
                              tickLine={false}
                              width={40}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#0A0C10', borderColor: '#1E293B', borderRadius: '8px', fontSize: '11px', color: '#CBD5E1' }}
                              itemStyle={{ color: '#2DD4BF' }}
                              labelFormatter={(val) => format(val, 'dd-MMM-yy HH:mm')}
                            />
                            <Line type="monotone" dataKey="Level" stroke="#64748B" strokeWidth={1} strokeOpacity={0.3} dot={{ r: 2, fill: '#64748B' }} name="Raw Level" />
                            <Line type="monotone" dataKey="compositeHI" stroke="#2DD4BF" strokeWidth={4} dot={false} name="Composite HI" />
                            <ReferenceLine y={threshold} stroke="#EF4444" strokeDasharray="8 8" strokeWidth={2} label={{ value: `FAILURE ${threshold.toFixed(1)}`, position: 'insideTopRight', fill: '#EF4444', fontSize: 10, fontWeight: 'bold' }} />
                            {results && results.fptThreshold && (
                              <ReferenceLine y={results.fptThreshold} stroke="#64748B" strokeDasharray="4 4" label={{ value: 'FPT LIMIT', position: 'insideLeft', fill: '#64748B', fontSize: 8 }} />
                            )}
                            {results && results.fptIndex !== null && processedData[results.fptIndex] && (
                              <ReferenceLine x={processedData[results.fptIndex].Datetime.getTime()} stroke="#FBBF24" strokeWidth={2} label={{ value: 'FPT DETECTION', position: 'insideBottomLeft', fill: '#FBBF24', fontSize: 9, fontWeight: 'bold', angle: 0 }} />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                       <div className="bg-card-bg p-8 rounded-3xl border border-slate-800 shadow-xl">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-8 flex items-center gap-2">
                          <AlertTriangle size={14} className="text-amber-500" /> Model Accuracy Breakdown
                        </h3>
                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={results.testData.map((d, i) => ({ ...d, pred: results.predictions[i] }))}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E293B" />
                              <XAxis dataKey="Datetime" tickFormatter={(val) => format(val, 'dd/MM')} tick={{ fontSize: 9, fill: '#64748B' }} />
                              <YAxis tick={{ fontSize: 9, fill: '#64748B' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#0A0C10', borderColor: '#1E293B' }} />
                              <Line type="monotone" dataKey="SmoothedLevel" stroke="#CBD5E1" strokeWidth={2} dot={false} name="Actual HI" />
                              <Line type="monotone" dataKey="pred" stroke="#F43F5E" strokeDasharray="5 5" strokeWidth={2} dot={false} name="Predicted HI" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-card-bg p-8 rounded-3xl border border-slate-800 shadow-xl">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-8 flex items-center gap-2">
                          <TrendingUp size={14} className="text-accent-teal" /> Degradation Path Projection
                        </h3>
                        <div className="h-[250px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={expData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1E293B" />
                              <XAxis dataKey="days" label={{ value: 't + Days', position: 'insideBottom', offset: -5, fontSize: 9, fill: '#64748B' }} tick={{ fontSize: 9, fill: '#64748B' }} />
                              <YAxis tick={{ fontSize: 9, fill: '#64748B' }} />
                              <Tooltip contentStyle={{ backgroundColor: '#0A0C10', borderColor: '#1E293B' }} />
                              <Line type="monotone" dataKey="value" stroke="#2DD4BF" strokeWidth={3} dot={false} name="Degradation Path" />
                              <ReferenceLine y={threshold} stroke="#EF4444" strokeDasharray="5 5" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'analysis' && (
                <motion.div 
                  key="analysis"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="bg-slate-900/50 p-12 rounded-[40px] border border-slate-800 shadow-3xl flex flex-col items-center text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#2DD4BF10,_transparent_70%)] pointer-events-none"></div>
                    <div className="bg-accent-teal/10 p-6 rounded-3xl mb-8 relative">
                      <Brain className="text-accent-teal h-14 w-14" />
                      <div className="absolute inset-0 bg-accent-teal/20 blur-2xl -z-10 rounded-full" />
                    </div>
                    <h2 className="text-3xl font-serif text-white mb-3">AI Maintenance Advisory</h2>
                    <p className="text-slate-400 max-w-lg mb-10 text-sm leading-relaxed">
                      Laporan kecerdasan buatan menyintesis data degradasi menjadi instruksi teknis yang dapat ditindaklanjuti bagi tim pemeliharaan preventif.
                    </p>
                    
                    <button 
                      onClick={runAiAnalysis}
                      disabled={isGeneratingAi || !results}
                      className={cn(
                        "group relative px-10 py-4 bg-accent-teal text-black font-bold uppercase tracking-widest text-[11px] rounded-full transition-all flex items-center gap-3 active:scale-95 shadow-[0_0_30px_rgba(45,212,191,0.2)]",
                        (isGeneratingAi || !results) && "opacity-40 cursor-not-allowed grayscale"
                      )}
                    >
                      {isGeneratingAi ? (
                        <>Analyzing Neural Path <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1 }}>...</motion.span></>
                      ) : (
                        <>Generate Technical Insight <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" /></>
                      )}
                    </button>
                  </div>

                  {aiReport && (
                    <motion.div 
                      key="report"
                      ref={reportRef}
                      id="report-to-export"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-card-bg p-12 rounded-[40px] border border-slate-800 shadow-inner relative overflow-hidden"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 mb-12">
                        <div className="flex items-start gap-6">
                          <div className="h-16 w-1 bg-accent-teal rounded-full" />
                          <div>
                            <h3 className="text-2xl font-serif italic text-white mb-1">Expert Maintenance Recommendation</h3>
                            <p className="text-[10px] font-mono font-bold tracking-[0.3em] text-slate-500 uppercase">Automated Report Module — Secure Link Active</p>
                          </div>
                        </div>
                        
                        <button 
                          onClick={handleDownloadPDF}
                          disabled={isExporting}
                          className={cn(
                            "flex items-center gap-2 px-4 py-2 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border",
                            isExporting 
                              ? "bg-slate-700 border-slate-600 cursor-not-allowed opacity-50" 
                              : "bg-slate-800 hover:bg-slate-700 border-slate-700 shadow-lg hover:shadow-accent-teal/10"
                          )}
                        >
                          {isExporting ? (
                            <div className="flex items-center gap-2">
                              <div className="h-3 w-3 border-2 border-accent-teal border-t-transparent rounded-full animate-spin" />
                              Processing...
                            </div>
                          ) : (
                            <>
                              <Download size={14} className="text-accent-teal" /> Download PDF
                            </>
                          )}
                        </button>
                      </div>
                      
                      <div className="markdown-container selection:bg-accent-teal/30">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ ...props }) => <h1 className="text-3xl font-serif text-white mb-6 mt-8" {...props} />,
                            h2: ({ ...props }) => <h2 className="text-2xl font-serif text-white mb-4 mt-10 border-b border-slate-800 pb-2" {...props} />,
                            h3: ({ ...props }) => <h3 className="text-lg font-bold text-accent-teal/90 mb-3 mt-8 uppercase tracking-wider" {...props} />,
                            h4: ({ ...props }) => <h4 className="text-base font-bold text-slate-200 mb-2 mt-6" {...props} />,
                            p: ({ ...props }) => <p className="mb-4 text-slate-300 leading-relaxed text-lg font-serif italic" {...props} />,
                            ul: ({ ...props }) => <ul className="list-disc pl-6 mb-6 space-y-3 text-slate-300 font-serif italic text-lg" {...props} />,
                            ol: ({ ...props }) => <ol className="list-decimal pl-6 mb-6 space-y-3 text-slate-300 font-serif italic text-lg" {...props} />,
                            li: ({ ...props }) => <li className="pl-2" {...props} />,
                            strong: ({ ...props }) => <strong className="text-white font-bold not-italic" {...props} />,
                            hr: ({ ...props }) => <hr className="my-10 border-slate-800" {...props} />,
                            blockquote: ({ ...props }) => <blockquote className="border-l-4 border-accent-teal/30 pl-6 italic my-8 text-slate-400 bg-accent-teal/5 py-4 rounded-r-lg" {...props} />,
                          }}
                        >
                          {aiReport}
                        </ReactMarkdown>
                      </div>
                      
                      <div className="mt-12 pt-8 border-t border-slate-800 flex justify-between items-center text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                        <span>Report ID: {Math.random().toString(36).substring(7).toUpperCase()}</span>
                        <div className="flex items-center gap-2">
                           <CheckCircle2 size={12} className="text-accent-teal" />
                           <span>Verifikasi Algoritma Selesai</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {activeTab === 'methodology' && (
                <motion.div 
                  key="methodology"
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                  className="space-y-12 pb-24 max-w-5xl mx-auto"
                >
                  {/* Header Metodologi */}
                  <div className="text-center space-y-4">
                    <h2 className="text-4xl font-serif text-white tracking-tight">Metodologi Sistem AI Prognostics</h2>
                    <p className="text-slate-400 max-w-2xl mx-auto italic">
                      Kombinasi Physics-Aware Prognostics, Analisis Statistik, dan Machine Learning Adaptif untuk Predictive Maintenance Bearing.
                    </p>
                  </div>

                  {/* Problem Statement & Goals */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 space-y-4">
                      <h3 className="text-xl font-serif text-white flex items-center gap-3">
                        <div className="bg-red-500/10 p-2 rounded-lg"><AlertTriangle className="text-red-400" size={18} /></div>
                        Problem Statement
                      </h3>
                      <div className="space-y-3 text-sm text-slate-400 leading-relaxed">
                        <p>
                          Kerusakan bearing merupakan salah satu penyebab utama downtime pada rotating machinery industri. Pendekatan monitoring konvensional berbasis threshold statis sering kali gagal mendeteksi degradasi dini dan tidak mampu memberikan estimasi waktu kegagalan yang adaptif.
                        </p>
                        <p>
                          Selain itu, kondisi operasional industri yang penuh noise dan variasi load menyebabkan prediksi berbasis regresi tunggal menjadi tidak stabil dan kurang realistis.
                        </p>
                        <p className="text-slate-300 font-medium pt-2">
                          Oleh karena itu, dikembangkan sistem AI Prognostics berbasis Physics-Aware Hybrid Degradation Modeling untuk menghasilkan prediksi RUL yang lebih stabil dan explainable.
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 space-y-4">
                      <h3 className="text-xl font-serif text-white flex items-center gap-3">
                        <div className="bg-accent-teal/10 p-2 rounded-lg"><CheckCircle2 className="text-accent-teal" size={18} /></div>
                        Tujuan Pengembangan Sistem
                      </h3>
                      <ul className="space-y-2">
                        {[
                          "Mendeteksi degradasi bearing sejak tahap awal",
                          "Mengurangi downtime tidak terencana",
                          "Menghasilkan estimasi RUL yang stabil dan explainable",
                          "Meningkatkan reliability maintenance berbasis kondisi aktual",
                          "Mengurangi false alarm akibat noise operasional industri"
                        ].map((goal, i) => (
                          <li key={i} className="flex items-center gap-3 text-sm text-slate-400">
                            <div className="h-1 w-1 rounded-full bg-accent-teal" />
                            {goal}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 space-y-4 md:col-span-2">
                      <h3 className="text-xl font-serif text-white flex items-center gap-3">
                        <div className="bg-accent-teal/10 p-2 rounded-lg"><Brain className="text-accent-teal" size={18} /></div>
                        Kontribusi Utama
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          "Mengembangkan hybrid degradation engine berbasis adaptive switching LDR/HDR",
                          "Mengintegrasikan probabilistic RUL estimation dengan confidence scoring",
                          "Menggunakan adaptive baseline learning untuk meningkatkan robustness antar mesin",
                          "Mengurangi instability prediction menggunakan hysteresis state control",
                          "Mengimplementasikan explainable prognostics untuk maintenance decision support"
                        ].map((item, i) => (
                          <div key={i} className="flex items-start gap-3 text-sm text-slate-400">
                            <div className="h-1 w-1 rounded-full bg-accent-teal mt-2 shrink-0" />
                            <p>{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Pendekatan Umum */}
                  <div className="bg-slate-900/50 p-10 rounded-3xl border border-slate-800 space-y-6">
                    <h3 className="text-2xl font-serif text-white flex items-center gap-3">
                      <div className="bg-accent-teal/10 p-2 rounded-lg"><Activity className="text-accent-teal" size={20} /></div>
                      Pendekatan Umum Sistem
                    </h3>
                    <div className="space-y-4 text-slate-300 leading-relaxed">
                      <p>
                        Sistem ini dirancang menggunakan pendekatan <strong>Physics-Aware Prognostics</strong>, yaitu kombinasi antara analisis statistik, pemodelan degradasi mekanis, dan machine learning adaptif untuk memprediksi <strong>Remaining Useful Life (RUL)</strong> bearing secara real-time.
                      </p>
                      <p>
                        Berbeda dengan sistem monitoring konvensional yang hanya menggunakan alarm threshold statis, sistem ini memahami siklus degradasi bearing secara dinamis melalui deteksi perubahan pola vibrasi dan analisis percepatan kerusakan.
                      </p>
                    </div>
                  </div>

                  {/* Arsitektur Visual (Detailed) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[
                      { title: "Sensor Vibrasi & Data Operasional", desc: "Akuisisi data kontinu mm/s dari titik sensor horizontal, vertikal, dan axial." },
                      { title: "Advanced Feature Extraction (RMS, Kurtosis, Env)", desc: "Transformasi sinyal mentah menjadi fitur sensitif terhadap degradasi mekanis awal." },
                      { title: "Composite Health Indicator (HI)", desc: "Fusi multi-fitur menjadi representasi kondisi kesehatan tunggal yang robust." },
                      { title: "EWMA & Kalman Filtering", desc: "Reduksi noise sensor dan stabilisasi tren menggunakan perataan statistik adaptif." },
                      { title: "Adaptive Baseline Learning", desc: "Sistem mempelajari kondisi 'sehat' unik setiap mesin sebagai referensi dinamis." },
                      { title: "FPT Detection Engine (Z-Score + Slope)", desc: "Mendeteksi First Predicting Time melalui persistensi anomali statistik." },
                      { title: "Hybrid State Classification (LDR/HDR)", desc: "Klasifikasi fase degradasi rendah (Linear) vs akselerasi tinggi (Eksponensial)." },
                      { title: "Adaptive Model Switching", desc: "Otomatisasi pemilihan algoritma sesuai dengan lintasan degradasi yang terdeteksi." },
                      { title: "Probabilistic RUL Estimation", desc: "Estimasi sisa umur dengan rentang ketidakpastian (confidence interval) yang realistis." }
                    ].map((step, i) => (
                      <div key={i} className="bg-slate-800/20 p-5 rounded-2xl border border-slate-700/50 flex flex-col gap-2 hover:bg-slate-800/40 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-accent-teal/50 font-bold">{i+1}.</span>
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{step.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed pl-7">{step.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Visual Architecture Diagram */}
                  <div className="bg-slate-900/80 p-8 rounded-3xl border border-slate-800 space-y-8 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                      <Brain size={200} className="text-accent-teal" />
                    </div>
                    <div className="text-center space-y-2 relative">
                      <h3 className="text-xl font-serif text-white">Architecture Flow: AI Prognostics Engine</h3>
                      <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em]">End-to-End Predictive Pipeline</p>
                    </div>

                    <div className="flex flex-wrap justify-center items-center gap-4 relative">
                      {[
                        { label: "Sensor Acquisition", icon: <Activity size={14} /> },
                        { label: "Signal Processing (EWMA+Kalman)", icon: <Settings size={14} /> },
                        { label: "Feature Extraction", icon: <BarChart3 size={14} /> },
                        { label: "Composite Health Indicator", icon: <TrendingUp size={14} /> },
                        { label: "Adaptive Baseline Learning", icon: <Settings size={14} /> },
                        { label: "FPT Detection Engine", icon: <TrendingUp size={14} /> },
                        { label: "State Classification (LDR/HDR)", icon: <Settings size={14} /> },
                        { label: "Adaptive Model Switching", icon: <Brain size={14} /> },
                        { label: "Probabilistic RUL Prediction", icon: <AlertTriangle size={14} /> },
                        { label: "Confidence & Risk Evaluation", icon: <CheckCircle2 size={14} /> },
                        { label: "Maintenance Decision Support", icon: <History size={14} /> },
                      ].map((node, i, arr) => (
                        <React.Fragment key={i}>
                          <div className="flex flex-col items-center gap-2">
                            <div className="h-12 w-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-accent-teal shadow-xl group hover:border-accent-teal/50 transition-colors">
                              {node.icon}
                            </div>
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter text-center w-20 leading-tight">{node.label}</span>
                          </div>
                          {i < arr.length - 1 && (
                            <div className="h-px w-2 bg-slate-800 hidden md:block" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {/* Keunggulan Inovasi & Real-Time Section */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800 space-y-6">
                      <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2 flex items-center gap-3">
                        <TrendingUp className="text-accent-teal" size={18} /> Keunggulan Inovasi Sistem
                      </h3>
                      <ul className="space-y-4">
                        {[
                          { title: "Adaptive Physics-Aware", desc: "Model memahami lifecycle degradasi bearing secara dinamis, bukan sekadar threshold statis." },
                          { title: "Hybrid Two-Stage Modeling", desc: "Menggabungkan model linear dan eksponensial sesuai fase degradasi aktual mesin." },
                          { title: "Probabilistic RUL Estimation", desc: "Prediksi disertai confidence interval sehingga lebih realistis untuk pengambilan keputusan." },
                          { title: "Industrial Noise Robustness", desc: "Menggunakan EWMA, Kalman Filtering, dan Hysteresis Control untuk menjaga stabilitas." }
                        ].map((item, i) => (
                          <li key={i} className="flex gap-4">
                            <div className="h-1.5 w-1.5 rounded-full bg-accent-teal mt-2 shrink-0" />
                            <div>
                              <h5 className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">{item.title}</h5>
                              <p className="text-[11px] text-slate-500 leading-relaxed">{item.desc}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-6">
                      <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
                        <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2 mb-4 flex items-center gap-3">
                          <Activity className="text-accent-teal" size={18} /> Real-Time Prognostics Capability
                        </h3>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Sistem dirancang untuk melakukan monitoring dan evaluasi degradasi secara kontinu menggunakan data streaming sensor sehingga prediksi dapat diperbarui secara adaptif terhadap perubahan kondisi operasional mesin secara instan.
                        </p>
                      </div>

                      <div className="bg-slate-900/50 p-8 rounded-3xl border border-slate-800">
                        <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2 mb-4 flex items-center gap-3">
                          <Brain className="text-accent-teal" size={18} /> Explainable AI Prognostics
                        </h3>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Setiap estimasi RUL dilengkapi interpretasi faktor dominan penyebab degradasi (seperti kenaikan RMS atau Kurtosis) sehingga hasil prediksi dapat dipahami engineer dan operator secara transparan tanpa "black-box effect".
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Potensi Implementasi Section */}
                  <div className="bg-slate-900/50 p-10 rounded-3xl border border-slate-800 space-y-8">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <h3 className="text-xl font-serif text-white">Potensi Implementasi Industri</h3>
                      <div className="flex flex-wrap gap-2">
                        {['Rotating Machinery', 'Pompa Industri', 'Motor Listrik', 'Conveyor', 'Blower'].map((tag) => (
                          <span key={tag} className="px-2 py-0.5 bg-slate-800 text-[9px] font-bold text-slate-400 uppercase rounded-md border border-slate-700">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      {[
                        { title: "Downtime Reduction", desc: "Mengurangi downtime tidak terencana akibat kerusakan komponen mendadak." },
                        { title: "Maintenance Optimization", desc: "Mengoptimalkan jadwal pemeliharaan berdasarkan kondisi nyata (CBM)." },
                        { title: "Cost Efficiency", desc: "Mengurangi biaya penggantian komponen prematur dan kerugian produksi." },
                        { title: "Reliability Focus", desc: "Meningkatkan reliability operasional sistem produksi secara keseluruhan." }
                      ].map((benefit, i) => (
                        <div key={i} className="space-y-2">
                          <h4 className="text-xs font-bold text-accent-teal uppercase tracking-widest">{benefit.title}</h4>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{benefit.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Detail Teknis Grid */}
                  <div className="grid grid-cols-1 gap-8">
                    <section className="space-y-6">
                      <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2">Data Characteristics & Feature Selection</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-slate-900/40 p-8 rounded-2xl border border-slate-800 space-y-4">
                           <h4 className="text-accent-teal font-bold text-xs uppercase tracking-[0.2em]">Alasan Pemilihan Feature</h4>
                           <p className="text-sm text-slate-400 leading-relaxed">
                            Kombinasi <strong>RMS, Kurtosis,</strong> dan <strong>Envelope RMS</strong> dipilih karena mampu merepresentasikan energi vibrasi umum, impulsivitas kerusakan mikro, dan frekuensi tinggi akibat kontak elemen bearing. Pendekatan multi-feature ini lebih sensitif terhadap <em>early fault</em> dibanding pemantauan single-feature.
                           </p>
                        </div>
                        <div className="bg-slate-900/40 p-8 rounded-2xl border border-slate-800 space-y-4">
                           <h4 className="text-accent-teal font-bold text-xs uppercase tracking-[0.2em]">Data Sampling & Quality</h4>
                           <p className="text-sm text-slate-400 leading-relaxed">
                            Data berasal dari sensor vibrasi akselerometer (mm/s) pada sumbu horizontal, vertikal, dan axial. Pengolahan data dilakukan untuk menangkap karakteristik degradasi secara menyeluruh dari fase awal hingga kegagalan kritis.
                           </p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-6">
                      <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2">Pemilihan dan Proses Data</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                          <h4 className="text-accent-teal font-bold text-xs uppercase tracking-[0.2em] mb-4">Filtering Logic</h4>
                          <ul className="space-y-3 text-sm text-slate-400">
                            <li><strong className="text-slate-200">Outlier Stabilization:</strong> Menstabilkan data abnormal sesaat secara statistik agar tidak memengaruhi tren utama.</li>
                            <li><strong className="text-slate-200">EWMA Smoothing:</strong> Menggunakan Exponentially Weighted Moving Average agar lebih responsif terhadap perubahan kondisi saat ini.</li>
                            <li><strong className="text-slate-200">Kalman Filtering:</strong> Meningkatkan kestabilan estimasi health trend dengan meminimalkan noise sensor.</li>
                          </ul>
                        </div>
                        <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                          <h4 className="text-accent-teal font-bold text-xs uppercase tracking-[0.2em] mb-4">Feature Layer</h4>
                          <ul className="space-y-3 text-sm text-slate-400">
                            <li><strong className="text-slate-200">RMS (Root Mean Square):</strong> Indikator energi total vibrasi mesin untuk kondisi mekanis umum.</li>
                            <li><strong className="text-slate-200">Kurtosis:</strong> Mendeteksi impulsivitas akibat benturan mikro (pitting/chipping) pada elemen bearing.</li>
                            <li><strong className="text-slate-200">Envelope RMS:</strong> Mengisolasi frekuensi tinggi akibat kontak elemen bearing yang mulai terdegradasi.</li>
                            <li><strong className="text-slate-200">Composite HI:</strong> Penggabungan seluruh fitur menjadi representasi kesehatan yang robust.</li>
                          </ul>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-6">
                      <h3 className="text-xl font-serif text-white border-b border-slate-800 pb-2">Modeling & Prognostics</h3>
                      <div className="space-y-6">
                        <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                          <h4 className="text-accent-teal font-bold text-xs uppercase tracking-[0.2em] mb-4">Hybrid Piecewise Degradation Modeling</h4>
                          <p className="text-sm text-slate-400 leading-relaxed mb-4">
                            Sistem menggunakan pendekatan dua tahap (Two-Stage Degradation Model) yang menyesuaikan algoritma dengan fase degradasi bearing:
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-800/40 rounded-xl">
                              <h5 className="text-white text-xs font-bold uppercase mb-2">LDR (Low Degradation Rate)</h5>
                              <p className="text-xs text-slate-500">Bearing masih relatif sehat dengan perubahan vibrasi lambat. Menggunakan regresi linear konservatif untuk monitoring stabilitas.</p>
                            </div>
                            <div className="p-4 bg-slate-800/40 rounded-xl border border-accent-teal/20">
                              <h5 className="text-accent-teal text-xs font-bold uppercase mb-2">HDR (High Degradation Rate)</h5>
                              <p className="text-xs text-slate-500">Kerusakan berkembang cepat ke arah non-linear. Sistem menjadi lebih agresif dalam estimasi failure menggunakan model eksponensial.</p>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                            <h4 className="text-slate-200 font-bold text-xs uppercase mb-3">Probabilistic RUL</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              Estimasi tidak deterministik (angka tunggal). Menggunakan confidence interval (95%) yang mempertimbangkan residual varians, variansi data sensor, dan trend stability.
                            </p>
                          </div>
                          <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                            <h4 className="text-slate-200 font-bold text-xs uppercase mb-3">Adaptive Baseline</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              Secara otomatis mempelajari baseline healthy-state tiap mesin (load/RPM unik) melalui rolling statistics agar threshold bersifat adaptif.
                            </p>
                          </div>
                          <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800">
                            <h4 className="text-slate-200 font-bold text-xs uppercase mb-3">FPT Detection</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              Deteksi First Predicting Time menggunakan kombinasi Z-Score statistik, Slope Persistence, dan Hysteresis State Control untuk menghindari false switching.
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Glosarium */}
                  <div className="bg-slate-900/50 p-10 rounded-3xl border border-slate-800 space-y-8">
                    <h3 className="text-xl font-serif text-white flex items-center gap-3">
                      <div className="bg-amber-500/10 p-2 rounded-lg"><Info className="text-amber-400" size={20} /></div>
                      Glosarium & Metrik Evaluasi
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                      {[
                        { term: 'RMSE (Average Error)', desc: 'Mengukur deviasi rata-rata antara prediksi dan data aktual sebagai indikator presisi fitting model.' },
                        { term: 'Prediction Stability Index', desc: 'Mengukur konsistensi estimasi RUL terhadap data baru untuk menjaga reliabilitas maintenance planning.' },
                        { term: 'Residual Drift Analysis', desc: 'Pemantauan perubahan residual error terhadap waktu untuk penyesuaian adaptif model.' },
                        { term: 'Hysteresis Control', desc: 'Logika durasi minimum anomali untuk memastikan perubahan status mesin permanen, bukan noise transien.' },
                        { term: 'ISO 10816 / 20816', desc: 'Standar internasional (Vibration Severity) sebagai referensi batas operasional aman.' },
                        { term: 'Life-Cycle Reset', desc: 'Kemampuan sistem mendeteksi pergantian bearing baru (penurunan vibrasi drastis) untuk memulai siklus prognostik baru.' },
                      ].map((item, idx) => (
                        <div key={idx} className="space-y-1">
                          <h4 className="text-accent-teal font-mono text-[10px] font-bold uppercase tracking-widest">{item.term}</h4>
                          <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* References & Identity */}
                  <div className="pt-12 border-t border-slate-800 space-y-12">
                      <div className="max-w-3xl mx-auto space-y-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.3em] text-center">Penutup</h4>
                        <p className="text-center text-slate-400 text-xs italic leading-relaxed">
                          "Pendekatan ini menghasilkan sistem predictive maintenance yang tidak hanya mampu memprediksi kegagalan bearing secara adaptif, tetapi juga memahami dinamika degradasi mesin secara lebih realistis melalui kombinasi signal processing, probabilistic prognostics, dan hybrid degradation modeling. Dengan pendekatan physics-aware dan explainable AI, sistem diharapkan mampu meningkatkan reliability operasional, mengurangi downtime tidak terencana, serta mendukung transformasi predictive maintenance berbasis data pada lingkungan industri modern."
                        </p>
                      </div>

                     <div className="space-y-8">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.3em] text-center mb-8">Daftar Pustaka & Referensi Ilmiah</h4>
                        
                        <div className="space-y-8 max-w-4xl mx-auto">
                          <div className="space-y-3">
                            <h5 className="text-[10px] font-bold text-accent-teal uppercase tracking-widest border-l-2 border-accent-teal pl-3">Skripsi & Dokumen Utama</h5>
                            <p className="text-[11px] text-slate-500 italic leading-relaxed pl-4">
                              Salsabila, L. (2024). Pemodelan Degradasi Berdasarkan Hasil Analisis Vibrasi Untuk Memprediksi Remaining Useful Life Pada Bearing (Skripsi). Program Studi Informatika, Fakultas Teknik, Universitas Mulawarman, Samarinda.
                            </p>
                          </div>

                          <div className="space-y-3">
                            <h5 className="text-[10px] font-bold text-accent-teal uppercase tracking-widest border-l-2 border-accent-teal pl-3">Buku Referensi (Prognostik)</h5>
                            <ul className="text-[11px] text-slate-500 italic leading-relaxed space-y-2 pl-4">
                              <li>Lei, Y. (2016). Intelligent Fault Diagnosis and Remaining Useful Life Prediction of Rotating Machinery. Oxford: Butterworth-Heinemann (Elsevier).</li>
                              <li>Si, X.-S., Zhang, Z.-X., & Hu, C.-H. (2017). Data-Driven Remaining Useful Life Prognosis Techniques: Stochastic Models, Methods and Applications. Springer-Verlag GmbH.</li>
                              <li>Lughofer, E., & Sayed-Mouchaweh, M. (Eds.). (2019). Predictive Maintenance in Dynamic Systems: Advanced Methods, Decision Support Tools and Real-World Applications. Springer Nature Switzerland AG.</li>
                              <li>Mobley, R. K. (2002). An Introduction to Predictive Maintenance (2nd ed.). Woburn: Elsevier Science.</li>
                            </ul>
                          </div>

                          <div className="space-y-3">
                            <h5 className="text-[10px] font-bold text-accent-teal uppercase tracking-widest border-l-2 border-accent-teal pl-3">Jurnal Ilmiah (Model & Validasi)</h5>
                            <ul className="text-[11px] text-slate-500 italic leading-relaxed space-y-2 pl-4">
                              <li>Si, X.-S., Wang, W., Hu, C.-H., & Zhou, D. H. (2011). Remaining useful life estimation—a review on the statistical data driven approaches. European Journal of Operational Research, 213(1).</li>
                              <li>Wang, B., Lei, Y., Li, N., & Li, N. (2020). A Hybrid Prognostics Approach for Estimating Remaining Useful Life of Rolling Element Bearings. IEEE Transactions on Reliability.</li>
                              <li>Chicco, D., Warrens, M. J., & Jurman, G. (2021). The coefficient of determination R-squared is more informative than RMSE in regression analysis evaluation. PeerJ Computer Science.</li>
                              <li>Yan, M., Wang, X., Wang, B., Chang, M., & Muhammad, I. (2020). Bearing remaining useful life prediction using support vector machine and hybrid degradation tracking model. ISA Transactions.</li>
                              <li>Elwany, A. H., & Gebraeel, N. Z. (2008). Sensor-driven prognostic models for equipment replacement and spare parts inventory. IIE Transactions.</li>
                              <li>Chai, T., & Draxler, R. R. (2014). Root mean square error (RMSE) or mean absolute error (MAE)? – Arguments against avoiding RMSE in the literature. Geoscientific Model Development, 7.</li>
                              <li>Hodson, T. O., Over, T. M., & Foks, S. F. (2021). Mean squared error, deconstructed. Journal of Advances in Modeling Earth Systems, 13.</li>
                            </ul>
                          </div>
                        </div>
                     </div>

                     <div className="flex flex-col items-center text-center space-y-6 pt-12 border-t border-slate-800/30">
                        <div className="h-20 w-20 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-accent-teal font-serif text-3xl shadow-2xl">LS</div>
                        <div className="space-y-2">
                          <h4 className="text-white font-bold text-xl tracking-tight">Luthfianda Salsabila</h4>
                          <p className="text-slate-500 text-sm italic font-mono">luthfiandasalsabila@gmail.com</p>
                        </div>
                        <div className="bg-accent-teal/5 border border-accent-teal/10 px-6 py-3 rounded-2xl max-w-sm">
                           <p className="text-[10px] text-accent-teal font-bold uppercase tracking-[0.2em] leading-relaxed flex flex-col items-center gap-2">
                             <span className="flex items-center gap-2"><CheckCircle2 size={14} /> Partisipasi Kompetisi</span>
                             <span className="text-white">Google #JuaraVibeCoding Season 1</span>
                           </p>
                        </div>
                     </div>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        {/* Footer info matching design */}
        <footer className="mt-auto border-t border-slate-800 pt-6 flex flex-col md:flex-row justify-between items-center text-[10px] text-slate-600 font-mono tracking-widest gap-4">
          <div>MATLAB_CORE ENGINE V1.8 | PRECISION: 64-BIT | UNIT: DAYS</div>
          <div className="flex gap-8">
            <span className="text-slate-500 uppercase">Bearing Series: AH-1042</span>
            <span className="text-accent-teal border-b border-accent-teal/40 pb-0.5">DASHBOARD_COLLECTING</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
