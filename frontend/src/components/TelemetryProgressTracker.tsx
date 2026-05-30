"use client";

import React, { useMemo } from "react";
import { useAppContext } from "./Providers";
import { Activity, ShieldAlert, Cpu, CheckCircle2, Loader2, PlayCircle, Send, Database, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export const TelemetryProgressTracker = () => {
  const { logs, selectedSession } = useAppContext();

  // Check which steps are complete based on log messages
  const trackerSteps = useMemo(() => {
    const steps = {
      initialized: false,
      dynatraceTopology: false,
      dynatraceAnomalies: false,
      gatewayForwarded: false,
      checkoutReceived: false,
      cacheLookup: null as null | "SUCCEEDED" | "FAILED",
      paymentAttempts: [] as Array<{ attempt: number; status: "SUCCEEDED" | "FAILED"; message: string }>,
      savedToDb: false
    };

    if (!selectedSession) return steps;

    // Scan logs in order
    logs.forEach(log => {
      const msg = log.message;
      if (msg.includes("Initiating incident replay")) {
        steps.initialized = true;
      }
      if (msg.includes("Retrieved topology baseline")) {
        steps.dynatraceTopology = true;
      }
      if (msg.includes("Davis AI Alert") || msg.includes("no pre-existing incident anomalies")) {
        steps.dynatraceAnomalies = true;
      }
      if (msg.includes("Forwarding incident trigger request") || msg.includes("transaction completed")) {
        steps.gatewayForwarded = true;
      }
      if (msg.includes("Checkout: Request received")) {
        steps.checkoutReceived = true;
      }
      if (msg.includes("Checkout Cache: Lookup")) {
        steps.cacheLookup = msg.includes("SUCCEEDED") ? "SUCCEEDED" : "FAILED";
      }
      if (msg.includes("Payment Attempt #")) {
        // Parse "Payment Attempt #X: STATUS"
        const match = msg.match(/Payment Attempt #(\d+): (FAILED|SUCCEEDED)/);
        if (match) {
          const attemptNum = parseInt(match[1], 10);
          const status = match[2] as "SUCCEEDED" | "FAILED";
          // Check if this attempt is already added
          if (!steps.paymentAttempts.some(p => p.attempt === attemptNum)) {
            steps.paymentAttempts.push({
              attempt: attemptNum,
              status: status,
              message: msg
            });
          }
        }
      }
      if (msg.includes("Successfully stored") && msg.includes("PostgreSQL")) {
        steps.savedToDb = true;
      }
    });

    return steps;
  }, [logs, selectedSession]);

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  return (
    <div className="w-full h-full bg-slate-950/70 border border-slate-850 rounded-xl relative overflow-hidden backdrop-blur-md grid-bg flex flex-col p-6 glow-box-blue justify-center items-center gap-6 min-h-[400px]">
      
      {/* Scanline grid overlay */}
      <div className="absolute inset-0 scanline pointer-events-none opacity-20" />

      {/* Title & Spinner */}
      <div className="text-center z-10 space-y-2">
        <div className="flex items-center justify-center gap-3">
          <Activity className="text-blue-500 animate-pulse" size={24} />
          <h2 className="text-base font-bold font-mono tracking-widest text-slate-100 uppercase">
            Telemetry Reconstruction Active
          </h2>
          <Loader2 className="animate-spin text-blue-400" size={18} />
        </div>
        <p className="text-xs text-slate-400 font-mono">
          Reassembling distributed OTel trace graphs...
        </p>
      </div>

      {/* Progress Checklist */}
      <div className="w-full max-w-[480px] bg-slate-900/80 border border-slate-800 rounded-xl p-5 z-10 space-y-4">
        <h3 className="text-[10px] font-mono tracking-widest text-slate-500 uppercase border-b border-slate-800 pb-2">
          Pipeline Status checklist
        </h3>

        <div className="space-y-3 font-mono text-xs">
          
          {/* Step 1: Initialization */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <PlayCircle size={14} className={trackerSteps.initialized ? "text-emerald-400" : "text-slate-600"} />
              <span className={trackerSteps.initialized ? "text-slate-200" : "text-slate-500"}>
                Incident Trigger Initialization
              </span>
            </div>
            {trackerSteps.initialized ? (
              <CheckCircle2 size={14} className="text-emerald-500 shadow-glow" />
            ) : (
              <span className="text-[10px] text-slate-600 animate-pulse">pending</span>
            )}
          </div>

          {/* Step 2: Dynatrace baseline */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Cpu size={14} className={trackerSteps.dynatraceTopology ? "text-teal-400" : "text-slate-600"} />
              <span className={trackerSteps.dynatraceTopology ? "text-slate-200" : "text-slate-500"}>
                Dynatrace: Smartscape Mapping
              </span>
            </div>
            {trackerSteps.dynatraceTopology ? (
              <CheckCircle2 size={14} className="text-teal-400" />
            ) : (
              trackerSteps.initialized ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <span className="text-[10px] text-slate-600">pending</span>
            )}
          </div>

          {/* Step 3: API Gateway forwarding */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Send size={14} className={trackerSteps.gatewayForwarded ? "text-amber-400" : "text-slate-600"} />
              <span className={trackerSteps.gatewayForwarded ? "text-slate-200" : "text-slate-500"}>
                Gateway: Request Forwarding
              </span>
            </div>
            {trackerSteps.gatewayForwarded ? (
              <CheckCircle2 size={14} className="text-amber-500" />
            ) : (
              trackerSteps.dynatraceTopology ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <span className="text-[10px] text-slate-600">pending</span>
            )}
          </div>

          {/* Step 4: Checkout & Cache execution */}
          {trackerSteps.checkoutReceived && (
            <motion.div 
              initial={{ opacity: 0, y: 5 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="flex items-center justify-between pl-3 border-l border-slate-800"
            >
              <div className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-slate-300">Checkout Service Pipeline</span>
              </div>
              {trackerSteps.cacheLookup ? (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  trackerSteps.cacheLookup === "SUCCEEDED" ? "bg-emerald-950/50 text-emerald-400 border border-emerald-900" : "bg-red-950/50 text-red-400 border border-red-900"
                }`}>
                  Cache: {trackerSteps.cacheLookup}
                </span>
              ) : (
                <Loader2 size={12} className="animate-spin text-blue-500" />
              )}
            </motion.div>
          )}

          {/* Step 5: Payment Retries Stream */}
          {trackerSteps.paymentAttempts.length > 0 && (
            <div className="pl-3 border-l border-slate-800 space-y-2">
              <span className="text-[10px] text-slate-500 tracking-wider uppercase">Downstream Retries:</span>
              <AnimatePresence>
                {trackerSteps.paymentAttempts.map((item) => (
                  <motion.div
                    key={item.attempt}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      {item.status === "FAILED" ? (
                        <AlertTriangle size={11} className="text-rose-500" />
                      ) : (
                        <CheckCircle2 size={11} className="text-emerald-500" />
                      )}
                      <span className={item.status === "FAILED" ? "text-rose-400" : "text-emerald-400"}>
                        Payment Attempt #{item.attempt}
                      </span>
                    </div>
                    <span className={item.status === "FAILED" ? "text-rose-500 font-bold" : "text-emerald-500 font-bold"}>
                      {item.status}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Step 6: OTel database storage */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/50">
            <div className="flex items-center gap-2.5">
              <Database size={14} className={trackerSteps.savedToDb ? "text-fuchsia-400" : "text-slate-600"} />
              <span className={trackerSteps.savedToDb ? "text-slate-200" : "text-slate-500"}>
                OTel Trace Database Ingestion
              </span>
            </div>
            {trackerSteps.savedToDb ? (
              <CheckCircle2 size={14} className="text-fuchsia-400" />
            ) : (
              trackerSteps.gatewayForwarded ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <span className="text-[10px] text-slate-600">pending</span>
            )}
          </div>

        </div>
      </div>

      {/* Live terminal logs ticker */}
      {latestLog && (
        <div className="w-full max-w-[480px] bg-slate-950 border border-slate-850 rounded-lg p-2.5 z-10 font-mono text-[10px] flex items-center gap-2 text-slate-400 shadow-inner">
          <span className="text-blue-500 animate-pulse shrink-0 font-bold">LOG &gt;</span>
          <span className="truncate flex-1">{latestLog.message}</span>
        </div>
      )}

    </div>
  );
};
