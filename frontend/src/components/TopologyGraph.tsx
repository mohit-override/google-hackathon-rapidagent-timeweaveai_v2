"use client";

import React, { useMemo, useState, useEffect } from "react";
import { ReactFlow, Background, Handle, Position, Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Custom Service Node Component
const ServiceNode = ({ data }: { data: any }) => {
  const isError = data.status === "ERROR";
  const isLatency = data.status === "LATENCY";
  const isRunning = data.status === "RUNNING";
  const isOk = data.status === "OK";

  let cardClass = "bg-slate-900/90 text-white rounded-lg p-3 w-48 border transition-all duration-300 ";
  if (isError) {
    cardClass += "border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.3)] pulse-red-ring";
  } else if (isLatency) {
    cardClass += "border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.25)]";
  } else if (isRunning) {
    cardClass += "border-blue-500/80 shadow-[0_0_15px_rgba(59,130,246,0.2)]";
  } else {
    cardClass += "border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]";
  }

  return (
    <div className={cardClass}>
      <Handle type="target" position={Position.Left} className="!bg-slate-700" />
      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
        <span className="font-semibold text-xs tracking-wider uppercase text-slate-100">{data.label}</span>
        <span
          className={`text-[9px] px-1 py-0.5 rounded font-mono font-bold ${
            isError
              ? "bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse"
              : isLatency
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : isRunning
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          }`}
        >
          {data.status}
        </span>
      </div>
      <div className="space-y-1 text-[10px] font-mono text-slate-400">
        <div className="flex justify-between">
          <span>Latency:</span>
          <span className={isLatency ? "text-amber-400 font-bold" : "text-slate-200"}>
            {data.latency > 0 ? `${data.latency.toFixed(0)}ms` : "idle"}
          </span>
        </div>
        {data.attempts > 1 && (
          <div className="flex justify-between text-amber-400 font-semibold animate-pulse">
            <span>Retries:</span>
            <span>{data.attempts}x</span>
          </div>
        )}
        <div className="flex justify-between text-[9px] text-slate-500 mt-1">
          <span>Host:</span>
          <span>{data.host}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-700" />
    </div>
  );
};

// Node Types mapping for React Flow
const nodeTypes = {
  serviceNode: ServiceNode,
};

import { TelemetrySpan } from "../types";

interface TopologyGraphProps {
  spans: TelemetrySpan[];
  currentTimeNano: number;
  activeScenario: string;
}

export default function TopologyGraph({ spans, currentTimeNano, activeScenario }: TopologyGraphProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  useEffect(() => {
    if (reactFlowInstance) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2 });
      }, 50);
    }
  }, [activeScenario, reactFlowInstance]);

  // Compute states of services based on spans before and at the current playhead
  const serviceData = useMemo(() => {
    const states: Record<
      string,
      { status: string; latency: number; errorRate: number; attempts: number; host: string }
    > = {
      "api-gateway": { status: "OK", latency: 0, errorRate: 0, attempts: 1, host: "host-gateway-01" },
      "checkout-service": { status: "OK", latency: 0, errorRate: 0, attempts: 1, host: "host-checkout-01" },
      "payment-service": { status: "OK", latency: 0, errorRate: 0, attempts: 1, host: "host-payment-01" },
      "redis-cache-service": { status: "OK", latency: 0, errorRate: 0, attempts: 1, host: "host-cache-01" },
    };

    // Filter spans that started before/at the current playhead
    const pastSpans = spans.filter((s) => s.startTimeUnixNano <= currentTimeNano);

    // Group spans by traceId to count checkout payment attempts
    const checkoutSpans = pastSpans.filter((s) => s.serviceName === "checkout-service");
    let maxPaymentAttempts = 1;

    checkoutSpans.forEach((cs) => {
      try {
        const attrs = JSON.parse(cs.attributesJson || "{}");
        if (attrs["checkout.payment_attempts"]) {
          const att = Number(attrs["checkout.payment_attempts"]);
          if (att > maxPaymentAttempts) maxPaymentAttempts = att;
        }
      } catch (e) {}
    });

    states["checkout-service"].attempts = maxPaymentAttempts;

    // Evaluate statuses of each service based on spans active at the playhead
    Object.keys(states).forEach((service) => {
      // Find spans for this service that are active *exactly* at this moment
      // Or if no span is active, take the most recent completed span
      const serviceSpans = pastSpans.filter((s) => s.serviceName === service);
      if (serviceSpans.length === 0) return;

      // Find if there is a span currently executing at the playhead
      const activeSpan = serviceSpans.find((s) => {
        const endTimeNano = s.startTimeUnixNano + s.durationMs * 1000000;
        return s.startTimeUnixNano <= currentTimeNano && currentTimeNano <= endTimeNano;
      });

      if (activeSpan) {
        // If it's active, determine the duration/latency in progress up to the playhead
        const elapsedMs = (currentTimeNano - activeSpan.startTimeUnixNano) / 1000000;
        states[service].latency = elapsedMs > 0 ? elapsedMs : 0;

        // Check if a child call within this request has already thrown an error up to this timestamp
        const hasChildError = pastSpans.some(s => 
          s.parentSpanId === activeSpan.spanId && 
          s.statusCode === "ERROR" && 
          s.startTimeUnixNano <= currentTimeNano
        );

        if (hasChildError) {
          states[service].status = "ERROR";
          states[service].errorRate = 100;
        } else if (
          (service === "redis-cache-service" && elapsedMs > 1000) ||
          (service === "payment-service" && elapsedMs > 2000) ||
          (service === "checkout-service" && elapsedMs > 2500)
        ) {
          states[service].status = "LATENCY";
        } else {
          states[service].status = "RUNNING";
        }
      } else {
        // Span has completed
        const lastSpan = serviceSpans[serviceSpans.length - 1];
        states[service].latency = lastSpan.durationMs;
        if (lastSpan.statusCode === "ERROR") {
          states[service].status = "ERROR";
          states[service].errorRate = 100;
        } else {
          states[service].status = "OK";
        }
      }
    });

    return states;
  }, [spans, currentTimeNano]);

  // Construct Nodes list
  const nodes: Node[] = useMemo(() => {
    return [
      {
        id: "api-gateway",
        type: "serviceNode",
        position: { x: 50, y: 150 },
        data: {
          label: "API Gateway",
          status: serviceData["api-gateway"].status,
          latency: serviceData["api-gateway"].latency,
          errorRate: serviceData["api-gateway"].errorRate,
          attempts: serviceData["api-gateway"].attempts,
          host: serviceData["api-gateway"].host,
        },
      },
      {
        id: "checkout-service",
        type: "serviceNode",
        position: { x: 300, y: 150 },
        data: {
          label: "Checkout Service",
          status: serviceData["checkout-service"].status,
          latency: serviceData["checkout-service"].latency,
          errorRate: serviceData["checkout-service"].errorRate,
          attempts: serviceData["checkout-service"].attempts,
          host: serviceData["checkout-service"].host,
        },
      },
      {
        id: "redis-cache-service",
        type: "serviceNode",
        position: { x: 580, y: 40 },
        data: {
          label: "Redis Cache",
          status: serviceData["redis-cache-service"].status,
          latency: serviceData["redis-cache-service"].latency,
          errorRate: serviceData["redis-cache-service"].errorRate,
          attempts: serviceData["redis-cache-service"].attempts,
          host: serviceData["redis-cache-service"].host,
        },
      },
      {
        id: "payment-service",
        type: "serviceNode",
        position: { x: 580, y: 260 },
        data: {
          label: "Payment Service",
          status: serviceData["payment-service"].status,
          latency: serviceData["payment-service"].latency,
          errorRate: serviceData["payment-service"].errorRate,
          attempts: serviceData["payment-service"].attempts,
          host: serviceData["payment-service"].host,
        },
      },
    ];
  }, [serviceData]);

  // Construct Edges list dynamically to animate connections based on traffic state
  const edges: Edge[] = useMemo(() => {
    // Determine active flow connections at playhead
    const pastSpans = spans.filter((s) => s.startTimeUnixNano <= currentTimeNano);
    
    const isCacheActive = pastSpans.some((s) => {
      const endTimeNano = s.startTimeUnixNano + s.durationMs * 1000000;
      return s.serviceName === "redis-cache-service" && s.startTimeUnixNano <= currentTimeNano && currentTimeNano <= endTimeNano;
    });

    const isPaymentActive = pastSpans.some((s) => {
      const endTimeNano = s.startTimeUnixNano + s.durationMs * 1000000;
      return s.serviceName === "payment-service" && s.startTimeUnixNano <= currentTimeNano && currentTimeNano <= endTimeNano;
    });

    const isCheckoutActive = pastSpans.some((s) => {
      const endTimeNano = s.startTimeUnixNano + s.durationMs * 1000000;
      return s.serviceName === "checkout-service" && s.startTimeUnixNano <= currentTimeNano && currentTimeNano <= endTimeNano;
    });

    // Color definitions
    const colorOk = "#10b981"; // green
    const colorError = "#ef4444"; // red
    const colorLatency = "#f59e0b"; // amber
    const colorActive = "#3b82f6"; // blue
    const colorIdle = "#334155"; // slate-700

    // Gateway to Checkout edge style
    let gwToCheckoutColor = colorIdle;
    let gwToCheckoutAnimated = false;
    if (isCheckoutActive) {
      gwToCheckoutColor = serviceData["checkout-service"].status === "ERROR" ? colorError : colorActive;
      gwToCheckoutAnimated = true;
    } else if (serviceData["checkout-service"].status === "ERROR") {
      gwToCheckoutColor = colorError;
    }

    // Checkout to Cache edge style
    let checkoutToCacheColor = colorIdle;
    let checkoutToCacheAnimated = false;
    if (isCacheActive) {
      checkoutToCacheColor = serviceData["redis-cache-service"].status === "LATENCY" ? colorLatency : colorActive;
      checkoutToCacheAnimated = true;
    } else if (serviceData["redis-cache-service"].status === "LATENCY") {
      checkoutToCacheColor = colorLatency;
    }

    // Checkout to Payment edge style
    let checkoutToPaymentColor = colorIdle;
    let checkoutToPaymentAnimated = false;
    if (isPaymentActive) {
      checkoutToPaymentColor = serviceData["payment-service"].status === "ERROR" ? colorError : colorActive;
      checkoutToPaymentAnimated = true;
    } else if (serviceData["payment-service"].status === "ERROR") {
      checkoutToPaymentColor = colorError;
    }

    return [
      {
        id: "e-gw-checkout",
        source: "api-gateway",
        target: "checkout-service",
        animated: gwToCheckoutAnimated,
        style: {
          stroke: gwToCheckoutColor,
          strokeWidth: gwToCheckoutAnimated ? 3 : 1.5,
          transition: "stroke 0.3s, stroke-width 0.3s",
        },
      },
      {
        id: "e-checkout-cache",
        source: "checkout-service",
        target: "redis-cache-service",
        animated: checkoutToCacheAnimated,
        style: {
          stroke: checkoutToCacheColor,
          strokeWidth: checkoutToCacheAnimated ? 3 : 1.5,
          transition: "stroke 0.3s, stroke-width 0.3s",
        },
      },
      {
        id: "e-checkout-payment",
        source: "checkout-service",
        target: "payment-service",
        animated: checkoutToPaymentAnimated,
        style: {
          stroke: checkoutToPaymentColor,
          strokeWidth: checkoutToPaymentAnimated ? 3 : 1.5,
          transition: "stroke 0.3s, stroke-width 0.3s",
        },
      },
    ];
  }, [spans, currentTimeNano, serviceData]);

  return (
    <div className="w-full h-full bg-slate-950/60 border border-slate-800/80 rounded-xl relative overflow-hidden backdrop-blur-md grid-bg glow-box-blue">
      {/* Scanline grid overlay */}
      <div className="absolute inset-0 scanline pointer-events-none opacity-30" />
      
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
        <span className="text-[10px] font-mono tracking-widest text-blue-400 uppercase font-bold">
          Smartscape Topology Map
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setReactFlowInstance}
        nodesConnectable={false}
        nodesDraggable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        preventScrolling={true}
      >
        <Background color="#1e293b" gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
