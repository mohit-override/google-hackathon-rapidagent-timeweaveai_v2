"use client";

import React, { useState, useMemo } from "react";
import { api } from "../lib/api";
import { useAppContext } from "./Providers";
import { Zap, Loader2, PlayCircle, Cpu, Send, CheckCircle2, AlertTriangle, Database } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export const ScenarioTrigger = () => {
  const { selectedSession, spans, logs, setSelectedSession } = useAppContext();
  const [isTriggering, setIsTriggering] = useState(false);

  const handleTrigger = async (scenario: string) => {
    setIsTriggering(true);
    try {
      const session = await api.triggerScenario(scenario);
      setSelectedSession(session);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTriggering(false);
    }
  };

  // Determine stepper states from logs
  const trackerSteps = useMemo(() => {
    const steps = {
      initialized: false,
      dynatraceTopology: false,
      gatewayForwarded: false,
      checkoutReceived: false,
      cacheLookup: null as null | "SUCCEEDED" | "FAILED",
      paymentAttempts: [] as Array<{ attempt: number; status: "SUCCEEDED" | "FAILED" }>,
      savedToDb: false
    };

    if (!selectedSession) return steps;

    logs.forEach(log => {
      const msg = log.message;
      if (msg.includes("Initiating incident replay")) {
        steps.initialized = true;
      }
      if (msg.includes("Retrieved topology baseline")) {
        steps.dynatraceTopology = true;
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
        const match = msg.match(/Payment Attempt #(\d+): (FAILED|SUCCEEDED)/);
        if (match) {
          const attemptNum = parseInt(match[1], 10);
          const status = match[2] as "SUCCEEDED" | "FAILED";
          if (!steps.paymentAttempts.some(p => p.attempt === attemptNum)) {
            steps.paymentAttempts.push({ attempt: attemptNum, status });
          }
        }
      }
      if (msg.includes("Successfully stored") && msg.includes("PostgreSQL")) {
        steps.savedToDb = true;
      }
    });

    return steps;
  }, [logs, selectedSession]);

  const showProgress = selectedSession && spans.length === 0;

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-xl p-5 glow-box-green flex flex-col gap-4">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <Zap className="text-emerald-500" size={20} />
        <h2 className="text-sm font-semibold tracking-wider text-slate-200 uppercase">
          Inject Chaos
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => handleTrigger("retry-storm")}
          disabled={isTriggering}
          className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono py-2.5 px-4 rounded transition-colors border border-slate-700 disabled:opacity-50 cursor-pointer"
        >
          {isTriggering ? <Loader2 size={14} className="animate-spin" /> : null}
          Trigger: Retry Storm
        </button>

        <button
          onClick={() => handleTrigger("cache-latency")}
          disabled={isTriggering}
          className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono py-2.5 px-4 rounded transition-colors border border-slate-700 disabled:opacity-50 cursor-pointer"
        >
          {isTriggering ? <Loader2 size={14} className="animate-spin" /> : null}
          Trigger: Cache Latency Spike
        </button>
      </div>

      {/* Live progress indicator when active and spans are loading */}
      <AnimatePresence>
        {showProgress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-slate-800 pt-4 flex flex-col gap-3 font-mono text-[10px] text-slate-400 overflow-hidden"
          >
            <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold uppercase tracking-wider animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              Ingesting Telemetry...
            </div>

            <div className="space-y-2">
              {/* Step 1: Replay Init */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <PlayCircle size={12} className={trackerSteps.initialized ? "text-emerald-400" : "text-slate-600"} />
                  Replay Initialized
                </span>
                {trackerSteps.initialized && <CheckCircle2 size={12} className="text-emerald-400" />}
              </div>

              {/* Step 2: Dynatrace */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Cpu size={12} className={trackerSteps.dynatraceTopology ? "text-teal-400" : "text-slate-600"} />
                  Dynatrace Topology Scan
                </span>
                {trackerSteps.dynatraceTopology && <CheckCircle2 size={12} className="text-teal-400" />}
              </div>

              {/* Step 3: Gateway */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Send size={12} className={trackerSteps.gatewayForwarded ? "text-amber-400" : "text-slate-600"} />
                  API Gateway Trigger
                </span>
                {trackerSteps.gatewayForwarded && <CheckCircle2 size={12} className="text-amber-400" />}
              </div>

              {/* Cache status details */}
              {trackerSteps.checkoutReceived && (
                <div className="flex items-center justify-between pl-3 border-l border-slate-800 text-[9px]">
                  <span>▸ Cache check</span>
                  {trackerSteps.cacheLookup ? (
                    <span className={trackerSteps.cacheLookup === "SUCCEEDED" ? "text-emerald-400" : "text-rose-400"}>
                      {trackerSteps.cacheLookup}
                    </span>
                  ) : (
                    <Loader2 size={9} className="animate-spin text-slate-500" />
                  )}
                </div>
              )}

              {/* Payment attempts details */}
              {trackerSteps.paymentAttempts.map((p) => (
                <div key={p.attempt} className="flex items-center justify-between pl-3 border-l border-slate-800 text-[9px]">
                  <span className="flex items-center gap-1">
                    {p.status === "FAILED" ? <AlertTriangle size={9} className="text-rose-500" /> : <CheckCircle2 size={9} className="text-emerald-500" />}
                    Payment Attempt #{p.attempt}
                  </span>
                  <span className={p.status === "FAILED" ? "text-rose-500 font-bold" : "text-emerald-500 font-bold"}>
                    {p.status}
                  </span>
                </div>
              ))}

              {/* Step 4: OTel */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Database size={12} className={trackerSteps.savedToDb ? "text-fuchsia-400" : "text-slate-600"} />
                  OTel DB Ingestion
                </span>
                {trackerSteps.savedToDb && <CheckCircle2 size={12} className="text-fuchsia-400" />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
