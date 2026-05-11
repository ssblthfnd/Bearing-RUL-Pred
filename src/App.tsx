import React, { useState } from 'react';
import { FileDown, Upload, Settings, Brain, BarChart3, TrendingUp, AlertTriangle, CheckCircle2, History, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { format } from 'date-fns';
import { preprocessData, trainModel, generateCSVTemplate, RawData, ProcessedData, ModelResults } from './lib/maintenance-logic';
import { generateMaintenanceReport } from './services/geminiService';
import { cn } from './lib/utils';

export default function App() {
  const [data, setData] = useState<RawData[]>([]);
  const [pointPrefix, setPointPrefix] = useState('A');
  const [threshold, setThreshold] = useState(4.5);
  const [processedData, setProcessedData] = useState<ProcessedData[]>([]);
  const [results, setResults] = useState<ModelResults | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const raw = results.data as RawData[];
        setData(raw);
        processAndModel(raw, pointPrefix, threshold);
      },
      error: (err) => {
        setError("Gagal membaca file CSV: " + err.message);
      }
    });
  };

  const processAndModel = (rawData: RawData[], prefix: string, thr: number) => {
    try {
      const processed = preprocessData(rawData, prefix);
      if (processed.length < 5) {
        setError("Data terlalu sedikit untuk kategori ini (minimal 5 data point).");
        setProcessedData([]);
        setResults(null);
        return;
      }
      setProcessedData(processed);
      const modelResults = trainModel(processed, thr);
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

  const expData = results ? Array.from({ length: 50 }).map((_, i) => {
    const futureDays = (results.rulDays * 1.2 / 49) * i;
    return {
      days: futureDays.toFixed(1),
      value: Math.exp(results.expIntercept + results.expSlope * futureDays)
    };
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
          </section>

          <section className="space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <Settings size={14} className="text-accent-teal" /> Parameters
            </h2>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Bearing Category</label>
              <select 
                value={pointPrefix}
                onChange={(e) => {
                  setPointPrefix(e.target.value);
                  if (data.length > 0) processAndModel(data, e.target.value, threshold);
                }}
                className="w-full mt-1.5 bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:border-accent-teal/50"
              >
                {['A', 'B', 'C', 'D'].map(p => <option key={p} value={p}>Category {p} Series</option>)}
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
                    if (data.length > 0) processAndModel(data, pointPrefix, val);
                  }}
                  className="flex-1 accent-accent-teal"
                />
                <span className="text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded border border-slate-700">{threshold.toFixed(2)}</span>
              </div>
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
                <p className="text-slate-500 text-sm">Predictive reporting for Bearing <span className="text-accent-teal font-bold">Category {pointPrefix}</span></p>
              </div>

              <nav className="flex border-b border-slate-800 w-full md:w-auto">
                {[
                  { id: 'dashboard', label: 'RUL Prediction', icon: TrendingUp },
                  { id: 'overview', label: 'Data Overview', icon: History },
                  { id: 'analysis', label: 'AI Insights', icon: Brain }
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
                          { label: 'Peak Velocity', value: `${Math.max(...processedData.map(d => d.Level)).toFixed(2)} mm/s` },
                          { label: 'Baseline level', value: `${Math.min(...processedData.map(d => d.Level)).toFixed(2)} mm/s` },
                          { label: 'Mean Velocity', value: `${(processedData.reduce((a, b) => a + b.Level, 0) / processedData.length).toFixed(2)} mm/s` }
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl overflow-hidden relative group">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Model Precision (RMSE)</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-4xl font-bold font-mono tracking-tighter text-white">{results.rmse.toFixed(4)}</p>
                        <span className="text-[9px] font-bold text-teal-400 uppercase">Validated</span>
                      </div>
                      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <BarChart3 size={40} className="text-white" />
                      </div>
                    </div>
                    
                    <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
                      <div className="absolute right-0 top-0 h-full w-1.5 bg-amber-500 opacity-50"></div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Estimated RUL</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-4xl font-bold font-mono tracking-tighter text-white">{results.rulDays.toFixed(1)} <span className="text-sm font-sans font-normal opacity-40">Days</span></p>
                      </div>
                    </div>

                    <div className="bg-slate-900/80 p-6 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Predicted Failure</p>
                      <p className="text-4xl font-bold font-mono tracking-tighter text-amber-500 shadow-amber-500/20">{format(results.failureDate, 'dd MMM yyyy')}</p>
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
                            <Line type="monotone" dataKey="SmoothedLevel" stroke="#2DD4BF" strokeWidth={4} dot={false} name="Prediction Curve" />
                            <ReferenceLine y={threshold} stroke="#EF4444" strokeDasharray="8 8" strokeWidth={2} label={{ value: `THRESHOLD ${threshold.toFixed(1)}`, position: 'insideTopRight', fill: '#EF4444', fontSize: 10, fontWeight: 'bold', offset: 10 }} />
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
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-card-bg p-12 rounded-[40px] border border-slate-800 shadow-inner relative overflow-hidden"
                    >
                      <div className="flex items-start gap-6 mb-12">
                        <div className="h-16 w-1 bg-accent-teal rounded-full" />
                        <div>
                          <h3 className="text-2xl font-serif italic text-white mb-1">Expert Maintenance Recommendation</h3>
                          <p className="text-[10px] font-mono font-bold tracking-[0.3em] text-slate-500 uppercase">Automated Report Module — Secure Link Active</p>
                        </div>
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
