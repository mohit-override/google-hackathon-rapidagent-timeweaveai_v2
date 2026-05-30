import { ReplaySession, SimulationResult, TelemetrySpan, OperationLog } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export const api = {
  getSessions: async (): Promise<ReplaySession[]> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  },

  getSessionSpans: async (sessionId: string): Promise<TelemetrySpan[]> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/spans`);
    if (!res.ok) throw new Error('Failed to fetch session spans');
    return res.json();
  },

  triggerScenario: async (scenario: string): Promise<ReplaySession> => {
    const res = await fetch(`${API_BASE_URL}/api/scenarios/trigger?scenario=${scenario}`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to trigger scenario');
    return res.json();
  },

  analyzeSession: async (sessionId: string): Promise<{ id: string; analysis: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/analyze`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to analyze session');
    return res.json();
  },

  simulateSession: async (sessionId: string): Promise<SimulationResult> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/simulate`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to run simulation');
    return res.json();
  },

  getSimulationResults: async (sessionId: string): Promise<SimulationResult[]> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/simulation-results`);
    if (!res.ok) throw new Error('Failed to fetch simulation results');
    return res.json();
  },

  getSessionLogs: async (sessionId: string): Promise<OperationLog[]> => {
    const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/logs`);
    if (!res.ok) throw new Error('Failed to fetch session logs');
    return res.json();
  }
};
