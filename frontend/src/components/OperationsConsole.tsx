"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAppContext } from "./Providers";
import { Terminal, ChevronDown, ChevronUp, Activity, Search, Trash2, Cpu, Sparkles, Database } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export const OperationsConsole = () => {
  const { logs, setLogs, selectedSession } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"ALL" | "DYNATRACE" | "GEMINI" | "OTEL" | "ENGINE">("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isOpen, activeTab]);

  // Determine stepper states from logs
  const stepStates = useMemo(() => {
    const states = {
      scenario: "pending", // pending, active, success, error
      dynatrace: "pending",
      otel: "pending",
      gemini: "pending"
    };

    if (!selectedSession) return states;

    // Check Scenario trigger logs
    const scenarioLogs = logs.filter(l => l.source === "Scenario" || l.source === "Gateway");
    if (scenarioLogs.length > 0) {
      states.scenario = "active";
      if (scenarioLogs.some(l => l.level === "ERROR")) {
        states.scenario = "error";
      } else if (scenarioLogs.some(l => l.message.includes("completed") || l.message.includes("complete"))) {
        states.scenario = "success";
      }
    }

    // Check Dynatrace logs
    const dtLogs = logs.filter(l => l.source === "Dynatrace");
    if (dtLogs.length > 0) {
      states.dynatrace = "active";
      if (dtLogs.some(l => l.level === "ERROR")) {
        states.dynatrace = "error";
      } else if (dtLogs.some(l => l.level === "WARNING")) {
        states.dynatrace = "warning"; // warning indicator
      } else if (dtLogs.some(l => l.level === "SUCCESS")) {
        states.dynatrace = "success";
      }
    }

    // Check OTel Ingestion logs
    const otelLogs = logs.filter(l => l.source === "OTel" || l.source === "Redis");
    if (otelLogs.length > 0) {
      states.otel = "active";
      if (otelLogs.some(l => l.level === "ERROR")) {
        states.otel = "error";
      } else if (otelLogs.some(l => l.message.includes("Successfully stored") || l.message.includes("saved"))) {
        states.otel = "success";
      }
    }

    // Check Gemini logs
    const geminiLogs = logs.filter(l => l.source === "Gemini");
    if (geminiLogs.length > 0) {
      states.gemini = "active";
      if (geminiLogs.some(l => l.level === "ERROR")) {
        states.gemini = "error";
      } else if (geminiLogs.some(l => l.level === "SUCCESS" && l.message.includes("completed"))) {
        states.gemini = "success";
      }
    }

    return states;
  }, [logs, selectedSession]);

  // Filter logs based on search and tab
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Tab filter
      if (activeTab === "DYNATRACE" && log.source !== "Dynatrace") return false;
      if (activeTab === "GEMINI" && log.source !== "Gemini") return false;
      if (activeTab === "OTEL" && log.source !== "OTel") return false;
      if (activeTab === "ENGINE" && !["Scenario", "Gateway", "Redis"].includes(log.source)) return false;

      // Search term filter
      if (searchTerm) {
        const text = `${log.source} ${log.level} ${log.message}`.toLowerCase();
        return text.includes(searchTerm.toLowerCase());
      }

      return true;
    });
  }, [logs, activeTab, searchTerm]);

  if (!selectedSession) {
    return (
      <div className="w-full bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-500 font-mono">
        Select or trigger an incident to enable the System Operations Console.
      </div>
    );
  }

  const formatLogTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour12: false }) + "." + String(date.getMilliseconds()).padStart(3, "0");
    } catch {
      return "00:00:00.000";
    }
  };

  const getSourceStyle = (source: string) => {
    switch (source) {
      case "Dynatrace":
        return "text-teal-400 bg-teal-950/40 border-teal-900/60";
      case "Gemini":
        return "text-blue-400 bg-blue-950/40 border-blue-900/60";
      case "OTel":
        return "text-fuchsia-400 bg-fuchsia-950/40 border-fuchsia-900/60";
      case "Redis":
        return "text-rose-400 bg-rose-950/40 border-rose-900/60";
      case "Gateway":
        return "text-amber-400 bg-amber-950/40 border-amber-900/60";
      default:
        return "text-slate-400 bg-slate-800/40 border-slate-700/60";
    }
  };

  const getLevelStyle = (level: string) => {
    switch (level) {
      case "SUCCESS":
        return "text-emerald-400 font-semibold";
      case "WARNING":
        return "text-amber-400 font-medium";
      case "ERROR":
        return "text-red-400 font-bold animate-pulse";
      default:
        return "text-slate-300";
    }
  };

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-850 rounded-xl overflow-hidden shadow-2xl transition-all duration-300">
      
      {/* Console Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-b border-slate-800 cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <Terminal size={18} className="text-blue-400" />
          <h2 className="text-xs font-bold font-mono tracking-wider text-slate-200 uppercase flex items-center gap-2">
            System Operations Console 
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-normal">
              {logs.length} events
            </span>
          </h2>
          
          {/* Latest log preview when collapsed */}
          {!isOpen && latestLog && (
            <div className="hidden lg:flex items-center gap-2 text-[10px] text-slate-500 font-mono max-w-[400px] truncate ml-4 animate-fade-in">
              <span className={`px-1.5 py-0.2 rounded border text-[9px] ${getSourceStyle(latestLog.source).split(" ")[0]}`}>
                {latestLog.source}
              </span>
              <span className="truncate">{latestLog.message}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Step Progress Visual Stepper */}
            <div className="bg-slate-950/30 px-6 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="text-[10px] font-mono tracking-widest text-slate-500 uppercase">
                Integration Pipeline:
              </div>
              
              <div className="flex-1 max-w-[650px] flex items-center justify-between relative px-2">
                {/* Connecting Lines */}
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-slate-800 -translate-y-1/2 z-0" />
                
                {/* Step 1: Scenario */}
                <div className="z-10 flex flex-col items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-mono font-bold transition-all ${
                    stepStates.scenario === "success" ? "bg-emerald-950 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" :
                    stepStates.scenario === "active" ? "bg-blue-950 border-blue-500 text-blue-400 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.4)]" :
                    stepStates.scenario === "error" ? "bg-red-950 border-red-500 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]" :
                    "bg-slate-900 border-slate-800 text-slate-600"
                  }`}>
                    1
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">Triggered</span>
                </div>

                {/* Step 2: Dynatrace */}
                <div className="z-10 flex flex-col items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-mono font-bold transition-all ${
                    stepStates.dynatrace === "success" ? "bg-emerald-950 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" :
                    stepStates.dynatrace === "warning" ? "bg-amber-950 border-amber-500 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]" :
                    stepStates.dynatrace === "active" ? "bg-blue-950 border-blue-500 text-blue-400 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.4)]" :
                    stepStates.dynatrace === "error" ? "bg-red-950 border-red-500 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]" :
                    "bg-slate-900 border-slate-800 text-slate-600"
                  }`}>
                    <Cpu size={11} className={stepStates.dynatrace === "active" ? "animate-spin" : ""} />
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">Dynatrace API</span>
                </div>

                {/* Step 3: OTel */}
                <div className="z-10 flex flex-col items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-mono font-bold transition-all ${
                    stepStates.otel === "success" ? "bg-emerald-950 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" :
                    stepStates.otel === "active" ? "bg-blue-950 border-blue-500 text-blue-400 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.4)]" :
                    stepStates.otel === "error" ? "bg-red-950 border-red-500 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]" :
                    "bg-slate-900 border-slate-800 text-slate-600"
                  }`}>
                    <Database size={11} />
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">OTel Collector</span>
                </div>

                {/* Step 4: Gemini */}
                <div className="z-10 flex flex-col items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-mono font-bold transition-all ${
                    stepStates.gemini === "success" ? "bg-emerald-950 border-emerald-500 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" :
                    stepStates.gemini === "active" ? "bg-blue-950 border-blue-500 text-blue-400 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.4)]" :
                    stepStates.gemini === "error" ? "bg-red-950 border-red-500 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]" :
                    "bg-slate-900 border-slate-800 text-slate-600"
                  }`}>
                    <Sparkles size={11} />
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">Gemini LLM</span>
                </div>
              </div>
            </div>

            {/* Toolbar Filters / Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between p-3 bg-slate-950/40 border-b border-slate-800 gap-3">
              {/* Tab Selector */}
              <div className="flex flex-wrap gap-1.5">
                {(["ALL", "DYNATRACE", "GEMINI", "OTEL", "ENGINE"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase transition-all ${
                      activeTab === tab 
                        ? "bg-blue-600 text-white shadow-[0_0_8px_rgba(59,130,246,0.4)]" 
                        : "bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {tab === "ENGINE" ? "Scenario Engine" : tab === "OTEL" ? "OTel Collector" : tab}
                  </button>
                ))}
              </div>

              {/* Search and controls */}
              <div className="flex items-center gap-3">
                <div className="relative flex items-center">
                  <Search size={12} className="absolute left-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search logs..."
                    className="pl-8 pr-3 py-1 bg-slate-950 text-xs font-mono text-slate-300 border border-slate-850 rounded w-48 focus:outline-none focus:border-blue-500 placeholder-slate-600"
                  />
                </div>
                
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-slate-950 border-slate-850 text-blue-600 focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-[10px] text-slate-500 font-mono uppercase">Auto Scroll</span>
                </label>
                
                <button
                  onClick={() => setLogs([])}
                  title="Clear Console Display"
                  className="p-1 rounded bg-slate-800/50 hover:bg-red-950/30 text-slate-500 hover:text-red-400 transition-colors border border-slate-850 hover:border-red-900/50"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Scrollable logs area */}
            <div className="h-60 overflow-y-auto bg-slate-950/80 p-4 font-mono text-[11px] leading-relaxed custom-scrollbar flex flex-col gap-1 shadow-inner relative">
              
              {filteredLogs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-600 italic">
                  {searchTerm ? "No matching log entries found." : "Waiting for background telemetry logs..."}
                </div>
              ) : (
                filteredLogs.map((log, idx) => (
                  <div key={log.id || idx} className="flex items-start gap-2 hover:bg-slate-900/40 p-0.5 rounded transition-all">
                    {/* Timestamp */}
                    <span className="text-slate-600 shrink-0 select-none">
                      [{formatLogTime(log.timestamp)}]
                    </span>
                    
                    {/* Source Tag */}
                    <span className={`px-1.5 py-0.2 shrink-0 select-none rounded border text-[9px] font-bold ${getSourceStyle(log.source)}`}>
                      {log.source.toUpperCase()}
                    </span>

                    {/* Message content with dynamic styling based on level */}
                    <span className={`flex-1 break-all ${getLevelStyle(log.level)}`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}

              {/* Terminal Cursor blinking at the end */}
              {filteredLogs.length > 0 && (
                <div className="flex items-center gap-1.5 text-slate-500 mt-1 select-none">
                  <span>$</span>
                  <span className="w-1.5 h-3 bg-blue-500 animate-blink" />
                </div>
              )}

              <div ref={consoleEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
