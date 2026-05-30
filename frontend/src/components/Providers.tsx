"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { ReplaySession, TelemetrySpan, OperationLog } from "../types";
import { getSignalRConnection, ensureConnection, joinSessionGroup, leaveSessionGroup } from "../lib/signalr";
import { api } from "../lib/api";

interface AppContextState {
  selectedSession: ReplaySession | null;
  setSelectedSession: React.Dispatch<React.SetStateAction<ReplaySession | null>>;
  spans: TelemetrySpan[];
  setSpans: React.Dispatch<React.SetStateAction<TelemetrySpan[]>>;
  logs: OperationLog[];
  setLogs: React.Dispatch<React.SetStateAction<OperationLog[]>>;
  currentTime: number; // UnixNano timestamp used for the slider
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  minTime: number;
  maxTime: number;
}

const AppContext = createContext<AppContextState | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedSession, setSelectedSession] = useState<ReplaySession | null>(null);
  const [spans, setSpans] = useState<TelemetrySpan[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const minTime = spans.length > 0 ? Math.min(...spans.map(s => s.startTimeUnixNano)) : 0;
  const maxTime = spans.length > 0 ? Math.max(...spans.map(s => s.endTimeUnixNano)) : 0;

  // SignalR integration
  useEffect(() => {
    const conn = getSignalRConnection();
    
    const handleNewSpan = (data: any) => {
      try {
        const span = typeof data === "string" ? JSON.parse(data) : data;
        
        // Ensure id and endTimeUnixNano are populated
        if (!span.id) {
          span.id = span.spanId || Math.random().toString();
        }
        if (!span.endTimeUnixNano && span.startTimeUnixNano && span.durationMs) {
          span.endTimeUnixNano = span.startTimeUnixNano + Math.round(span.durationMs * 1000000);
        }

        setSpans(prev => {
          // avoid duplicates by checking both id and spanId
          if (prev.find(p => p.id === span.id || p.spanId === span.spanId)) return prev;
          return [...prev, span];
        });
      } catch (err) {
        console.error("Failed to parse incoming span", err);
      }
    };

    const handleNewLog = (data: any) => {
      try {
        const log = typeof data === "string" ? JSON.parse(data) : data;
        setLogs(prev => {
          if (prev.find(l => l.id === log.id)) return prev;
          return [...prev, log];
        });
      } catch (err) {
        console.error("Failed to parse incoming log", err);
      }
    };

    conn.on("ReceiveTelemetry", handleNewSpan);
    conn.on("ReceiveTelemetrySpan", handleNewSpan);
    conn.on("ReceiveLog", handleNewLog);

    ensureConnection().catch(console.error);

    return () => {
      conn.off("ReceiveTelemetry", handleNewSpan);
      conn.off("ReceiveTelemetrySpan", handleNewSpan);
      conn.off("ReceiveLog", handleNewLog);
    };
  }, []);

  // Join/Leave groups when session changes
  useEffect(() => {
    if (selectedSession) {
      joinSessionGroup(selectedSession.id).catch(console.error);
    }

    return () => {
      if (selectedSession) {
        leaveSessionGroup(selectedSession.id).catch(console.error);
      }
    };
  }, [selectedSession]);

  // Fetch historical spans & logs when session changes (e.g. on page refresh)
  useEffect(() => {
    if (selectedSession) {
      // Clear logs first before starting trigger or fetching historical
      setSpans([]);
      setLogs([]);

      api.getSessionSpans(selectedSession.id)
        .then(fetchedSpans => {
          setSpans(fetchedSpans);
        })
        .catch(console.error);

      api.getSessionLogs(selectedSession.id)
        .then(fetchedLogs => {
          setLogs(fetchedLogs);
        })
        .catch(console.error);
    } else {
      setSpans([]);
      setLogs([]);
    }
  }, [selectedSession]);

  // Adjust current time slider boundary when new spans arrive
  useEffect(() => {
    if (maxTime > 0 && currentTime === 0) {
      setCurrentTime(maxTime); // Snap to max time initially
    }
  }, [maxTime, currentTime]);

  return (
    <AppContext.Provider
      value={{
        selectedSession,
        setSelectedSession,
        spans,
        setSpans,
        logs,
        setLogs,
        currentTime,
        setCurrentTime,
        minTime,
        maxTime,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};
