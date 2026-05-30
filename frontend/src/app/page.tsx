"use client";

import React, { useEffect, useState } from "react";
import { ReplaySession } from "../types";
import TopologyGraph from "../components/TopologyGraph";
import { TimelineSlider } from "../components/TimelineSlider";
import { AIAnalysisPanel } from "../components/AIAnalysisPanel";
import { SimulationPanel } from "../components/SimulationPanel";
import { ScenarioTrigger } from "../components/ScenarioTrigger";
import { OperationsConsole } from "../components/OperationsConsole";
import { useAppContext } from "../components/Providers";
import { api } from "../lib/api";
import { Activity } from "lucide-react";

export default function Home() {
  const { selectedSession, setSelectedSession, spans, currentTime } = useAppContext();

  const [history, setHistory] = useState<ReplaySession[]>([]);

  // Load history on mount and whenever selectedSession changes (i.e. new scenario triggered)
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const sessions = await api.getSessions();
        setHistory(sessions);
      } catch (err) {
        console.error("Failed to load history", err);
      }
    };
    loadHistory();
  }, [selectedSession]);

  return (
    <main className="flex-1 flex flex-col p-4 gap-4 bg-gray-950 text-gray-100 h-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900/50 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <Activity className="text-blue-500" />
          <h1 className="text-xl font-bold tracking-widest uppercase">TimeWeave <span className="text-blue-500">AI</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">View History:</span>
            <select 
              className="bg-slate-950 text-xs font-mono text-slate-300 border border-slate-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500 max-w-[250px]"
              value={selectedSession?.id || ""}
              onChange={(e) => {
                const session = history.find(s => s.id === e.target.value);
                if (session) setSelectedSession(session);
              }}
            >
              <option value="" disabled>Select an incident...</option>
              {history.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({new Date(s.triggeredAt).toLocaleTimeString()})</option>
              ))}
            </select>
          </div>
          {selectedSession && (
            <div className="text-[10px] font-mono text-slate-600 hidden md:block">
              ID: {selectedSession.id.split('-')[0]}...
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
        {/* Left Sidebar - Controls */}
        <div className="w-full lg:w-[350px] flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2 pb-10">
          <ScenarioTrigger />
          <AIAnalysisPanel />
          <SimulationPanel />
        </div>

        {/* Right Area - Visualization */}
        <div className="flex-1 flex flex-col gap-4 relative overflow-y-auto custom-scrollbar pb-10">
          <div className="min-h-[400px] h-[450px] shrink-0">
            <TopologyGraph 
              spans={spans}
              currentTimeNano={currentTime}
              activeScenario={selectedSession?.scenarioName || ""} 
            />
          </div>

          <div className="h-24 shrink-0">
            <TimelineSlider />
          </div>
          
          <div className="shrink-0">
            <OperationsConsole />
          </div>
        </div>
      </div>
    </main>
  );
}
