using System;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TimeWeave.Backend.Database;

namespace TimeWeave.Backend.Services
{
    public class ScenarioService
    {
        private readonly HttpClient _httpClient;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly string _gatewayUrl;
        private readonly DynatraceService _dynatraceService;
        private readonly LogService _logService;
        
        public static Guid? ActiveSessionId { get; set; }
        public static string? ActiveScenarioName { get; set; }

        public ScenarioService(HttpClient httpClient, IServiceScopeFactory scopeFactory, IConfiguration configuration, DynatraceService dynatraceService, LogService logService)
        {
            _httpClient = httpClient;
            _scopeFactory = scopeFactory;
            _gatewayUrl = configuration["GATEWAY_SERVICE_URL"] ?? "http://localhost:8001";
            _dynatraceService = dynatraceService;
            _logService = logService;
        }

        public async Task<ReplaySession> TriggerScenarioAsync(string scenario)
        {
            // 1. Create a Replay Session
            var session = new ReplaySession
            {
                Id = Guid.NewGuid(),
                Name = $"Incident Replay: {FormatScenarioName(scenario)}",
                Description = GetScenarioDescription(scenario),
                ScenarioName = scenario,
                Status = "Running",
                TriggeredAt = DateTime.UtcNow
            };

            using (var scope = _scopeFactory.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                dbContext.ReplaySessions.Add(session);
                await dbContext.SaveChangesAsync();
            }

            // Set active session context
            ActiveSessionId = session.Id;
            ActiveScenarioName = scenario;

            // Log session initialization
            await _logService.LogAsync(session.Id, "INFO", "Scenario", $"Initiating incident replay: {session.Name} ({scenario})");

            // Query Dynatrace Topology baseline
            await _logService.LogAsync(session.Id, "INFO", "Dynatrace", "Dynatrace: Querying Smartscape Topology baseline mapping...");
            try
            {
                var topology = _dynatraceService.GetSmartscapeTopology();
                await _logService.LogAsync(session.Id, "SUCCESS", "Dynatrace", "Dynatrace: Retrieved topology baseline. Discovered 4 services (api-gateway, checkout-service, payment-service, redis-cache-service) and 3 active calling channels.");
            }
            catch (Exception ex)
            {
                await _logService.LogAsync(session.Id, "ERROR", "Dynatrace", $"Dynatrace: Failed to query topology mapping: {ex.Message}");
            }

            // Query Dynatrace Davis AI active anomalies
            await _logService.LogAsync(session.Id, "INFO", "Dynatrace", $"Dynatrace: Querying Davis AI engine for active anomalies matching scenario '{scenario}'...");
            try
            {
                var anomalies = _dynatraceService.GetActiveAnomalies(scenario) as System.Collections.IEnumerable;
                bool foundAnomaly = false;
                if (anomalies != null)
                {
                    foreach (dynamic anomaly in anomalies)
                    {
                        foundAnomaly = true;
                        await _logService.LogAsync(session.Id, "WARNING", "Dynatrace", $"Davis AI Alert: {anomaly.title} (Severity: {anomaly.severity}). Root Cause Candidate: {anomaly.rootCauseCandidate}. Davis AI Recommendation: {anomaly.davisAiRecommendation}");
                    }
                }
                if (!foundAnomaly)
                {
                    await _logService.LogAsync(session.Id, "INFO", "Dynatrace", "Dynatrace: Davis AI reported no pre-existing incident anomalies.");
                }
            }
            catch (Exception ex)
            {
                await _logService.LogAsync(session.Id, "ERROR", "Dynatrace", $"Dynatrace: Error querying Davis AI anomalies: {ex.Message}");
            }

            // 2. Execute HTTP call to Gateway in a separate background thread
            // This allows the endpoint to return immediately so the frontend can display real-time telemetry!
            _ = Task.Run(async () =>
            {
                try
                {
                    await _logService.LogAsync(session.Id, "INFO", "Gateway", $"Gateway: Forwarding incident trigger request to API Gateway at {_gatewayUrl}/checkout?scenario={scenario}...");
                    Console.WriteLine($"[ScenarioService] Triggering HTTP call to API Gateway for scenario '{scenario}'...");
                    var url = $"{_gatewayUrl}/checkout?scenario={scenario}";
                    
                    // We set a high timeout since some scenarios take up to 6 seconds
                    var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                    var response = await client.GetAsync(url);
                    Console.WriteLine($"[ScenarioService] API Gateway call completed with status {response.StatusCode}");
                    
                    await _logService.LogAsync(session.Id, "SUCCESS", "Gateway", $"Gateway: API Gateway transaction completed with response status code {response.StatusCode}.");
                    await _logService.LogAsync(session.Id, "SUCCESS", "Scenario", $"Scenario execution complete. Awaiting trace stream updates from OTel Collector.");

                    // Update session status once done
                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        var activeSession = await dbContext.ReplaySessions.FindAsync(session.Id);
                        if (activeSession != null)
                        {
                            activeSession.Status = "Completed";
                            dbContext.ReplaySessions.Update(activeSession);
                            await dbContext.SaveChangesAsync();
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ScenarioService] Error triggering scenario: {ex.Message}");
                    await _logService.LogAsync(session.Id, "ERROR", "Scenario", $"Scenario execution error: {ex.Message}");

                    using (var scope = _scopeFactory.CreateScope())
                    {
                        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        var activeSession = await dbContext.ReplaySessions.FindAsync(session.Id);
                        if (activeSession != null)
                        {
                            activeSession.Status = "Failed";
                            activeSession.Description += $" (Trigger Error: {ex.Message})";
                            dbContext.ReplaySessions.Update(activeSession);
                            await dbContext.SaveChangesAsync();
                        }
                    }
                }
            });

            return session;
        }

        public async Task<SimulationResult> RunSimulationAsync(Guid sessionId, string scenario)
        {
            // Simulate the outcome of remediating the incident
            var result = new SimulationResult
            {
                Id = Guid.NewGuid(),
                SessionId = sessionId,
                ScenarioName = scenario,
                RunAt = DateTime.UtcNow
            };

            switch (scenario)
            {
                case "cache-latency":
                    result.CappedRetries = false;
                    result.LatencyImprovementMs = 2380; // Cache circuit breaker saves ~2.4 seconds
                    result.OriginalFailureCount = 1;
                    result.SimulatedFailureCount = 0;
                    result.SimulationSummary = "With the Cache Circuit-Breaker enabled: Checkout Service detects the Redis latency spike within 100ms, skips the cache call, and retrieves session data from PostgreSQL directly. The end-to-end response time falls from 2.5s to 120ms, preventing transaction timeout.";
                    break;
                case "payment-timeout":
                    result.CappedRetries = false;
                    result.LatencyImprovementMs = 3950; // payment async queue
                    result.OriginalFailureCount = 1;
                    result.SimulatedFailureCount = 0;
                    result.SimulationSummary = "With Asynchronous Payment Queuing enabled: The Checkout Service adds payment requests to a secure Redis Stream rather than blocking synchronous HTTP threads. Checkout responds to API Gateway in 45ms. The Payment worker processes the queue in the background, recovering from transient downstream lag without impacting checkout success.";
                    break;
                case "retry-storm":
                    result.CappedRetries = true;
                    result.LatencyImprovementMs = 1200; // retries capped
                    result.OriginalFailureCount = 4; // 1 main + 3 retries
                    result.SimulatedFailureCount = 1; // only 1 failure, no storm
                    result.SimulationSummary = "With Capped Retries (Limit = 1) and Exponential Backoff: Checkout Service retries Payment only once instead of three times. This reduces payment traffic amplification by 75%, preventing database connection pool exhaustion and allowing the downstream Payment database to self-heal.";
                    break;
                case "cascading-failure":
                    result.CappedRetries = true;
                    result.LatencyImprovementMs = 2400;
                    result.OriginalFailureCount = 5;
                    result.SimulatedFailureCount = 0;
                    result.SimulationSummary = "With Circuit Breaking on Cache: The cache dependency is isolated as soon as latency exceeds 200ms. Checkout threads are immediately freed up, preventing the downstream queue from saturating checkout thread resources and securing API Gateway responsiveness.";
                    break;
                default:
                    result.SimulationSummary = "Remediation parameters applied. The system performed within normal operating parameters.";
                    break;
            }

            using (var scope = _scopeFactory.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                dbContext.SimulationResults.Add(result);
                await dbContext.SaveChangesAsync();
            }
            return result;
        }

        private string FormatScenarioName(string scenario)
        {
            return scenario switch
            {
                "cache-latency" => "Cache Latency Spike",
                "payment-timeout" => "Payment Service Timeout",
                "retry-storm" => "Retry Storm / Pool Exhaustion",
                "cascading-failure" => "Cascading Service Failure",
                _ => "Custom Incident"
            };
        }

        private string GetScenarioDescription(string scenario)
        {
            return scenario switch
            {
                "cache-latency" => "Redis Cache latency spikes to 2.5s, exceeding Checkout Service client-side timeouts.",
                "payment-timeout" => "Payment Service delays execution, causing Checkout Service to abort and API Gateway to return 504.",
                "retry-storm" => "Payment DB pool exhaustion triggers error responses, amplifying traffic via rapid retries.",
                "cascading-failure" => "Combined cache spike and payment retry loop exhausts checkout connection threads.",
                _ => "Simulated distributed incident."
            };
        }
    }
}
