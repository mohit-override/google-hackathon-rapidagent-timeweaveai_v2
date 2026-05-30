"use client";

import React, { useEffect, useState, useRef } from "react";
import { useAppContext } from "./Providers";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";

export const TimelineSlider = () => {
  const { spans, currentTime, setCurrentTime, minTime, maxTime } = useAppContext();
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Animation ref
  const reqRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number | null>(null);

  const playDurationMs = 15000; // 15 seconds to play from start to finish
  const totalSimulatedTimeNano = maxTime - minTime;

  const accumulatedTimeRef = useRef<number>(0);

  // Keep refs of values accessed by the loop to avoid resetting requestAnimationFrame every frame
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!isPlaying) {
      lastUpdateRef.current = null;
      accumulatedTimeRef.current = 0;
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      return;
    }

    // Reset loop if at the end
    if (currentTimeRef.current >= maxTime && maxTime > 0) {
      setCurrentTime(minTime);
    }

    let lastRenderTime = 0;

    const animate = (time: number) => {
      if (!isPlayingRef.current) return;

      if (!lastUpdateRef.current) lastUpdateRef.current = time;
      const deltaMs = time - lastUpdateRef.current;
      lastUpdateRef.current = time;

      const nanoPerMs = totalSimulatedTimeNano / playDurationMs;
      const stepNano = deltaMs * nanoPerMs;

      accumulatedTimeRef.current += stepNano;

      // Throttle: only update state every 33ms (30fps) to prevent paint overloading
      if (time - lastRenderTime >= 33) {
        setCurrentTime((prev: number) => {
          const next = prev + accumulatedTimeRef.current;
          accumulatedTimeRef.current = 0;
          if (next >= maxTime) {
            return maxTime;
          }
          return next;
        });
        lastRenderTime = time;
      }

      reqRef.current = requestAnimationFrame(animate);
    };

    reqRef.current = requestAnimationFrame(animate);

    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [isPlaying, maxTime, minTime, totalSimulatedTimeNano, setCurrentTime]);

  // Auto-stop when playhead reaches maxTime
  useEffect(() => {
    if (currentTime >= maxTime && isPlaying) {
      setIsPlaying(false);
    }
  }, [currentTime, maxTime, isPlaying]);

  if (spans.length === 0) {
    return (
      <div className="w-full flex items-center justify-center p-4 bg-slate-900 border border-slate-800 rounded-lg">
        <span className="text-slate-500 font-mono text-xs">Waiting for telemetry data...</span>
      </div>
    );
  }

  // Handle manual scrub
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(Number(e.target.value));
  };

  const formatTime = (nano: number) => {
    if (nano === 0 || minTime === 0) return "0.00s";
    return ((nano - minTime) / 1000000000).toFixed(2) + "s";
  };

  const progressPercent = totalSimulatedTimeNano > 0 
    ? ((currentTime - minTime) / totalSimulatedTimeNano) * 100 
    : 100;

  return (
    <div className="w-full bg-slate-900/80 backdrop-blur-md border border-slate-700 p-4 rounded-xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
          Replay Timeline
        </div>
        <div className="text-xs font-mono text-blue-400">
          T+ {formatTime(currentTime)}
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentTime(minTime)}
            className="p-1.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <SkipBack size={16} />
          </button>
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-2.5 rounded-full text-white transition-all ${
              isPlaying 
                ? "bg-amber-500 hover:bg-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.5)]" 
                : "bg-blue-600 hover:bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
            }`}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <button 
            onClick={() => setCurrentTime(maxTime)}
            className="p-1.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="flex-1 relative flex items-center h-8">
          {/* Custom slider track */}
          <div className="absolute left-0 right-0 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-75 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {/* Native range input overlay */}
          <input 
            type="range" 
            min={minTime} 
            max={maxTime} 
            value={currentTime} 
            onChange={handleScrub}
            className="w-full absolute opacity-0 cursor-pointer h-full z-10"
          />
          {/* Handle indicator */}
          <div 
            className="absolute h-4 w-4 bg-white border-2 border-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)] pointer-events-none transition-all duration-75 ease-linear z-0"
            style={{ left: `calc(${progressPercent}% - 8px)` }}
          />
        </div>
      </div>
    </div>
  );
};
