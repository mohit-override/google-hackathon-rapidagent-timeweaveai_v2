using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimeWeave.Backend.Database;
using TimeWeave.Backend.Models;

namespace TimeWeave.Backend.Services
{
    public class TelemetryIngestionService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly RedisStreamService _redisStreamService;
        private readonly LogService _logService;
        
        // Cache to link Trace IDs to active Session IDs
        private static readonly ConcurrentDictionary<string, Guid> TraceToSessionMap = new();

        public TelemetryIngestionService(IServiceScopeFactory scopeFactory, RedisStreamService redisStreamService, LogService logService)
        {
            _scopeFactory = scopeFactory;
            _redisStreamService = redisStreamService;
            _logService = logService;
        }

        public async Task IngestTracesJsonAsync(string jsonPayload)
        {
            var parsedSpans = OTelJsonParser.Parse(jsonPayload);
            if (parsedSpans.Count == 0) return;

            using var scope = _scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Determine active session for querying existing payment attempts
            var activeSessionId = ScenarioService.ActiveSessionId ?? Guid.Empty;
            int existingPaymentSpans = 0;
            if (activeSessionId != Guid.Empty)
            {
                try
                {
                    existingPaymentSpans = await dbContext.TelemetrySpans.CountAsync(s => s.SessionId == activeSessionId && s.ServiceName == "payment-service");
                }
                catch {}
            }

            int paymentCount = existingPaymentSpans;

            // Sort spans: child operations (which complete first) are processed first, 
            // and parent/root spans (which complete last) are processed last.
            var sortedSpans = parsedSpans
                .OrderBy(s => string.IsNullOrEmpty(s.ParentSpanId) ? 1 : 0)
                .ThenBy(s => s.StartTimeUnixNano)
                .ToList();

            foreach (var parsed in sortedSpans)
            {
                // Resolve Session ID
                Guid sessionId = Guid.Empty;
                if (!string.IsNullOrEmpty(parsed.TraceId))
                {
                    if (ScenarioService.ActiveSessionId.HasValue)
                    {
                        sessionId = TraceToSessionMap.GetOrAdd(parsed.TraceId, ScenarioService.ActiveSessionId.Value);
                    }
                    else
                    {
                        TraceToSessionMap.TryGetValue(parsed.TraceId, out sessionId);
                    }
                }

                if (sessionId == Guid.Empty)
                {
                    // Fallback to active session or skip
                    sessionId = ScenarioService.ActiveSessionId ?? Guid.Empty;
                    if (sessionId == Guid.Empty)
                    {
                        Console.WriteLine($"[TelemetryIngestionService] Warning: Received span without active session. Skipping.");
                        continue;
                    }
                }

                // Log the ingestion
                var level = parsed.StatusCode == "ERROR" ? "ERROR" : "INFO";
                bool isRoot = string.IsNullOrEmpty(parsed.ParentSpanId);

                if (isRoot)
                {
                    await _logService.LogAsync(sessionId, level, "OTel", $"OTel: Transaction Completed - {parsed.Name} for service '{parsed.ServiceName}' (Total Duration: {parsed.DurationMs:F2}ms, Status: {parsed.StatusCode})");
                }
                else
                {
                    await _logService.LogAsync(sessionId, level, "OTel", $"OTel: Received span '{parsed.Name}' for service '{parsed.ServiceName}' (Duration: {parsed.DurationMs:F2}ms, Status: {parsed.StatusCode})");
                }

                if (parsed.StatusCode == "ERROR" && !string.IsNullOrEmpty(parsed.StatusMessage))
                {
                    await _logService.LogAsync(sessionId, "ERROR", "OTel", $"OTel Error: Service '{parsed.ServiceName}' failed with message: '{parsed.StatusMessage}'");
                }

                // Log Dynatrace connection
                await _logService.LogAsync(sessionId, "INFO", "Dynatrace", $"Dynatrace: Correlating OTel span '{parsed.SpanId}' ({parsed.ServiceName}) with Smartscape host node.");

                // Log specific service pipeline operations
                if (parsed.ServiceName == "checkout-service" && parsed.Name == "GET /checkout")
                {
                    await _logService.LogAsync(sessionId, "INFO", "Scenario", "Checkout: Request received from API Gateway. Starting downstream pipeline...");
                }
                else if (parsed.ServiceName == "redis-cache-service")
                {
                    var cacheStatus = parsed.StatusCode == "ERROR" ? "FAILED" : "SUCCEEDED";
                    var cacheLevel = parsed.StatusCode == "ERROR" ? "ERROR" : "SUCCESS";
                    await _logService.LogAsync(sessionId, cacheLevel, "Scenario", $"Checkout Cache: Lookup {cacheStatus} (Duration: {parsed.DurationMs}ms)");
                }
                else if (parsed.ServiceName == "payment-service")
                {
                    paymentCount++;
                    var pLevel = parsed.StatusCode == "ERROR" ? "ERROR" : "SUCCESS";
                    var pStatus = parsed.StatusCode == "ERROR" ? "FAILED" : "SUCCEEDED";
                    await _logService.LogAsync(sessionId, pLevel, "Scenario", $"Payment Attempt #{paymentCount}: {pStatus} (Duration: {parsed.DurationMs}ms)");
                }

                // Map to EF entity
                var entity = new TelemetrySpan
                {
                    Id = Guid.NewGuid(),
                    SessionId = sessionId,
                    TraceId = parsed.TraceId,
                    SpanId = parsed.SpanId,
                    ParentSpanId = parsed.ParentSpanId,
                    ServiceName = parsed.ServiceName,
                    Name = parsed.Name,
                    StartTimeUnixNano = parsed.StartTimeUnixNano,
                    EndTimeUnixNano = parsed.EndTimeUnixNano,
                    DurationMs = parsed.DurationMs,
                    StatusCode = parsed.StatusCode,
                    StatusMessage = parsed.StatusMessage,
                    AttributesJson = JsonSerializer.Serialize(parsed.Attributes)
                };

                // Save to PostgreSQL
                dbContext.TelemetrySpans.Add(entity);

                // Publish to Redis Streams for live frontend ingestion
                await _redisStreamService.PublishSpanAsync(sessionId.ToString(), parsed);
            }

            await dbContext.SaveChangesAsync();
            Console.WriteLine($"[TelemetryIngestionService] Successfully saved {parsedSpans.Count} spans to DB.");

            if (activeSessionId != Guid.Empty)
            {
                await _logService.LogAsync(activeSessionId, "SUCCESS", "OTel", $"OTel: Successfully stored {parsedSpans.Count} telemetry spans in PostgreSQL.");
                await _logService.LogAsync(activeSessionId, "INFO", "Redis", $"Redis: Telemetry spans published to Redis Stream 'telemetry:stream'. SignalR consumers notified.");
            }
        }
    }
}
