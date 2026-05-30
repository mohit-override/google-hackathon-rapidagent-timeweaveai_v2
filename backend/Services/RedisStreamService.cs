using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using StackExchange.Redis;
using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TimeWeave.Backend.Hubs;
using TimeWeave.Backend.Models;

namespace TimeWeave.Backend.Services
{
    public class RedisStreamService : BackgroundService
    {
        private readonly IConnectionMultiplexer _redis;
        private readonly IHubContext<ReplayHub> _hubContext;
        private const string StreamKey = "telemetry:stream";

        public RedisStreamService(IConnectionMultiplexer redis, IHubContext<ReplayHub> hubContext)
        {
            _redis = redis;
            _hubContext = hubContext;
        }

        public async Task PublishSpanAsync(string sessionId, ParsedSpan span)
        {
            try
            {
                var db = _redis.GetDatabase();
                var values = new[]
                {
                    new NameValueEntry("sessionId", sessionId),
                    new NameValueEntry("traceId", span.TraceId),
                    new NameValueEntry("spanId", span.SpanId),
                    new NameValueEntry("parentSpanId", span.ParentSpanId ?? string.Empty),
                    new NameValueEntry("serviceName", span.ServiceName),
                    new NameValueEntry("name", span.Name),
                    new NameValueEntry("durationMs", span.DurationMs.ToString()),
                    new NameValueEntry("statusCode", span.StatusCode),
                    new NameValueEntry("statusMessage", span.StatusMessage ?? string.Empty),
                    new NameValueEntry("startTimeUnixNano", span.StartTimeUnixNano.ToString()),
                    new NameValueEntry("attributesJson", JsonSerializer.Serialize(span.Attributes))
                };
                
                await db.StreamAddAsync(StreamKey, values);
                Console.WriteLine($"[RedisStreamService] Published span {span.SpanId} ({span.ServiceName}) for session {sessionId}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[RedisStreamService] Error publishing span to Redis: {ex.Message}");
            }
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            Console.WriteLine("[RedisStreamService] Starting Redis Stream consumer background service...");
            var db = _redis.GetDatabase();
            
            // Start reading from the end of the stream (only new messages)
            string lastId = "0-0";
            try
            {
                if (await db.KeyExistsAsync(StreamKey))
                {
                    var info = await db.StreamInfoAsync(StreamKey);
                    if (info.Length > 0)
                    {
                        lastId = info.LastEntry.Id.ToString();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[RedisStreamService] Error initializing stream consumer starting ID: {ex.Message}");
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var entries = await db.StreamReadAsync(StreamKey, lastId, count: 20);
                    if (entries != null && entries.Length > 0)
                    {
                        foreach (var entry in entries)
                        {
                            lastId = entry.Id;
                            
                            var sessionId = entry.Values.FirstOrDefault(v => v.Name == "sessionId").Value.ToString() ?? "";
                            var traceId = entry.Values.FirstOrDefault(v => v.Name == "traceId").Value.ToString() ?? "";
                            var spanId = entry.Values.FirstOrDefault(v => v.Name == "spanId").Value.ToString() ?? "";
                            var parentSpanId = entry.Values.FirstOrDefault(v => v.Name == "parentSpanId").Value.ToString() ?? "";
                            var serviceName = entry.Values.FirstOrDefault(v => v.Name == "serviceName").Value.ToString() ?? "";
                            var name = entry.Values.FirstOrDefault(v => v.Name == "name").Value.ToString() ?? "";
                            var durationMsStr = entry.Values.FirstOrDefault(v => v.Name == "durationMs").Value.ToString() ?? "";
                            var statusCode = entry.Values.FirstOrDefault(v => v.Name == "statusCode").Value.ToString() ?? "";
                            var statusMessage = entry.Values.FirstOrDefault(v => v.Name == "statusMessage").Value.ToString() ?? "";
                            var startTimeStr = entry.Values.FirstOrDefault(v => v.Name == "startTimeUnixNano").Value.ToString() ?? "";
                            var attributesJson = entry.Values.FirstOrDefault(v => v.Name == "attributesJson").Value.ToString() ?? "";
                            
                            double.TryParse(durationMsStr, out double durationMs);
                            long.TryParse(startTimeStr, out long startTimeUnixNano);
                            long endTimeUnixNano = startTimeUnixNano + (long)(durationMs * 1000000);

                            // Stream details to the SignalR group corresponding to the SessionId
                            await _hubContext.Clients.Group(sessionId).SendAsync("ReceiveTelemetrySpan", new
                            {
                                id = spanId,
                                sessionId,
                                traceId,
                                spanId,
                                parentSpanId,
                                serviceName,
                                name,
                                durationMs,
                                statusCode,
                                statusMessage,
                                startTimeUnixNano,
                                endTimeUnixNano,
                                attributesJson
                            }, cancellationToken: stoppingToken);
                        }
                    }
                    else
                    {
                        // No new messages, sleep briefly
                        await Task.Delay(100, stoppingToken);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[RedisStreamService] Exception in consumer loop: {ex.Message}");
                    await Task.Delay(2000, stoppingToken);
                }
            }
        }
    }
}
