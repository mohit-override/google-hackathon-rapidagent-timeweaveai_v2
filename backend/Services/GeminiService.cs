using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using TimeWeave.Backend.Database;

namespace TimeWeave.Backend.Services
{
    public class GeminiService
    {
        private readonly string? _apiKey;
        private readonly HttpClient _httpClient;
        private readonly LogService _logService;

        public GeminiService(IConfiguration configuration, HttpClient httpClient, LogService logService)
        {
            _apiKey = configuration["GEMINI_API_KEY"];
            _httpClient = httpClient;
            _logService = logService;
        }

        public async Task<string> GenerateRootCauseAnalysisAsync(ReplaySession session, List<TelemetrySpan> spans)
        {
            await _logService.LogAsync(session.Id, "INFO", "Gemini", "Gemini: Initiating AI Root Cause Analysis report generation...");
            await _logService.LogAsync(session.Id, "INFO", "Gemini", $"Gemini: Aggregating telemetry traces ({spans.Count} active spans found).");

            if (string.IsNullOrWhiteSpace(_apiKey))
            {
                await _logService.LogAsync(session.Id, "WARNING", "Gemini", "Gemini: API Key is missing. Using high-fidelity mock fallback analysis.");
                Console.WriteLine("[GeminiService] API Key is missing. Using high-fidelity mock fallback analysis.");
                var mockText = GetMockAnalysis(session.ScenarioName);
                await _logService.LogAsync(session.Id, "SUCCESS", "Gemini", $"Gemini: Mock analysis retrieved successfully ({mockText.Length} characters of report text).");
                return mockText;
            }

            try
            {
                // Format spans for the prompt
                var sb = new StringBuilder();
                sb.AppendLine($"Scenario: {session.ScenarioName}");
                sb.AppendLine("Incident Spans:");
                foreach (var s in spans)
                {
                    sb.AppendLine($"- Service: {s.ServiceName}, Operation: {s.Name}, Status: {s.StatusCode}, Duration: {s.DurationMs}ms, Error: {s.StatusMessage}");
                }

                await _logService.LogAsync(session.Id, "INFO", "Gemini", "Gemini: Compiling trace dependency graph into LLM prompt template...");

                string prompt = $@"
You are an expert Reliability Engineer and Incident Commander. Analyze the following distributed system trace timeline and telemetry.
Determine the root cause, explain how the failure propagated, and write a human-readable incident narration and causal summary.

{sb.ToString()}

Provide your output as a clean, professionally formatted markdown report with the following sections:
1. ### Incident Summary
2. ### Causal Chain Propagation (list how it propagated from the source to the client)
3. ### Root Cause Explanation (detail the exact root cause, e.g. cache latency or database connection pool issues)
4. ### Counterfactual Remediation (suggest what would happen if retries were capped, a circuit breaker was added, etc.)
";

                await _logService.LogAsync(session.Id, "INFO", "Gemini", $"Gemini: Invoking Gemini 2.5 Flash API (Model: gemini-2.5-flash) with {prompt.Length} characters of graph context.");

                var requestBody = new
                {
                    contents = new[]
                    {
                        new { parts = new[] { new { text = prompt } } }
                    }
                };

                string jsonRequest = JsonSerializer.Serialize(requestBody);
                string url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={_apiKey}";
                
                var request = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(jsonRequest, Encoding.UTF8, "application/json")
                };

                var startTime = DateTime.UtcNow;
                var response = await _httpClient.SendAsync(request);
                response.EnsureSuccessStatusCode();

                string jsonResponse = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(jsonResponse);
                
                var text = doc.RootElement
                    .GetProperty("candidates")[0]
                    .GetProperty("content")
                    .GetProperty("parts")[0]
                    .GetProperty("text")
                    .GetString();

                var duration = (DateTime.UtcNow - startTime).TotalSeconds;
                await _logService.LogAsync(session.Id, "SUCCESS", "Gemini", $"Gemini: API call completed in {duration:F2} seconds. Parsed generated report content ({text?.Length ?? 0} characters).");

                return text ?? "Unable to extract analysis from Gemini response.";
            }
            catch (Exception ex)
            {
                await _logService.LogAsync(session.Id, "ERROR", "Gemini", $"Gemini Error: API request failed ({ex.Message}). Falling back to mock template analysis.");
                Console.WriteLine($"[GeminiService] Error calling Gemini API: {ex.Message}. Falling back to mock analysis.");
                return GetMockAnalysis(session.ScenarioName);
            }
        }

        public string GetMockAnalysis(string scenario)
        {
            return scenario switch
            {
                "cache-latency" => @"### Incident Summary
A critical latency spike in the cache layer was observed, causing Checkout Service transactions to fail client-side timeouts.

### Causal Chain Propagation
1. **Redis Cache Service** experienced a 2500ms latency spike on `GET /get`.
2. **Checkout Service** initiated a call to the cache with a 1500ms timeout.
3. The cache call timed out, causing **Checkout Service** to log a cache failure.
4. While Checkout Service attempted to fallback, the overall transaction exceeded the API Gateway's expectations, propagating latencies to the frontend.

### Root Cause Explanation
The root cause is a **Cache Response Timeout**. Because the cache service latency (2500ms) exceeded the Checkout Service client timeout (1500ms), the cache lookup failed. This triggered resource waiting and response time degradation.

### Counterfactual Remediation
- **Implement Cache Circuit-Breaker**: If the cache latency spike persists, fail fast (in 100ms) and use an in-memory fallback, saving 1400ms of waiting time per request.
- **Adjust Timeout Thresholds**: Reduce client cache timeout to 200ms with a fallback to direct database queries.",

                "payment-timeout" => @"### Incident Summary
An upstream timeout occurred in Checkout Service because Payment Service failed to respond within the allocated client timeout boundary, propagating 504 errors.

### Causal Chain Propagation
1. **Payment Service** experienced a connection delay, taking 4000ms to process `GET /pay`.
2. **Checkout Service** requested payment validation with a client timeout of 1500ms.
3. **Checkout Service** aborted the connection after 1500ms, logging a payment timeout error.
4. **API Gateway** received a 500 error from Checkout and returned a `504 Gateway Timeout` to the client.

### Root Cause Explanation
The root cause is a **Payment Timeout Propagation**. The Payment service failed to reply within the Checkout service's 1500ms timeout budget due to upstream payment network delays.

### Counterfactual Remediation
- **Implement Asynchronous Payments**: Use a messaging queue (e.g. Redis Stream) to process payments asynchronously rather than blocking synchronous HTTP threads.
- **Decrease Timeout & Enable Retries with Backoff**: Fallback gracefully or queue transaction status check instead of crashing the checkout pipeline.",

                "retry-storm" => @"### Incident Summary
A retry storm saturated the downstream Payment Service database connection pool, turning a localized error into a cascading outage.

### Causal Chain Propagation
1. **Payment Service** returned a `500 Database Saturated` error due to a database connection limit being reached.
2. **Checkout Service** caught the error and immediately initiated 3 rapid retry attempts with no exponential backoff.
3. These retries amplified traffic from Checkout to Payment by **400%**, saturating all remaining connections.
4. API Gateway became unresponsive due to connection socket exhaustion.

### Root Cause Explanation
The root cause is **Retry Amplification (Retry Storm)**. The absence of exponential backoff and request jitter in Checkout Service caused it to flood the already failing Payment Service with retries, creating a self-inflicted denial of service.

### Counterfactual Remediation
- **Cap Retries**: Capping Checkout retries to 1 instead of 3 decreases payment traffic amplification by **75%**.
- **Jitter and Exponential Backoff**: Staggering retries prevents the checkout service from hitting the payment database connection pool all at once, allowing connections to recover.",

                "cascading-failure" => @"### Incident Summary
A classic cascading failure occurred where cache latencies led to Checkout thread pool saturation, which subsequently starved downstream socket connections to Payment Service.

### Causal Chain Propagation
1. **Redis Cache** latency spiked to 2500ms.
2. **Checkout Service** threads got blocked waiting for cache responses, accumulating pending requests.
3. Checkout's thread pool became exhausted, causing incoming API Gateway requests to queue up.
4. Queued requests timed out, and the cascading saturation blocked Checkout from making successful payments.

### Root Cause Explanation
The root cause is **Cascading Resource Saturation**. The primary trigger was Cache latency, which saturated Checkout's request handling capacity, cascading upstream to the API Gateway.

### Counterfactual Remediation
- **Circuit Breaker on Cache**: Disabling Cache calls during high latency prevents thread pool blockage, preserving resources for payments.",
                
                _ => "### Incident Analysis\nNo trace data was selected for analysis."
            };
        }
    }
}
