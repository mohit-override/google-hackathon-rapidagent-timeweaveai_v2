using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace TimeWeave.Backend.Database
{
    public class ReplaySession
    {
        [Key]
        public Guid Id { get; set; }
        
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        
        [MaxLength(500)]
        public string Description { get; set; } = string.Empty;
        
        public DateTime TriggeredAt { get; set; } = DateTime.UtcNow;
        
        [MaxLength(50)]
        public string Status { get; set; } = "Completed"; // Completed, Failed, Running
        
        [MaxLength(100)]
        public string ScenarioName { get; set; } = string.Empty;
        
        [Column(TypeName = "jsonb")]
        public string? CausalChainJson { get; set; }
        
        public string? RootCauseSummary { get; set; }
        
        public string? GeminiAnalysis { get; set; }
    }

    public class TelemetrySpan
    {
        [Key]
        public Guid Id { get; set; }
        
        public Guid SessionId { get; set; }
        
        [Required]
        [MaxLength(64)]
        public string TraceId { get; set; } = string.Empty;
        
        [Required]
        [MaxLength(32)]
        public string SpanId { get; set; } = string.Empty;
        
        [MaxLength(32)]
        public string? ParentSpanId { get; set; }
        
        [Required]
        [MaxLength(100)]
        public string ServiceName { get; set; } = string.Empty;
        
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        
        public long StartTimeUnixNano { get; set; }
        
        public long EndTimeUnixNano { get; set; }
        
        public double DurationMs { get; set; }
        
        [MaxLength(50)]
        public string StatusCode { get; set; } = "UNSET"; // OK, ERROR, UNSET
        
        public string? StatusMessage { get; set; }
        
        [Column(TypeName = "jsonb")]
        public string AttributesJson { get; set; } = "{}";
    }

    public class SimulationResult
    {
        [Key]
        public Guid Id { get; set; }
        
        public Guid SessionId { get; set; }
        
        [Required]
        [MaxLength(100)]
        public string ScenarioName { get; set; } = string.Empty;
        
        public bool CappedRetries { get; set; }
        
        public double LatencyImprovementMs { get; set; }
        
        public int OriginalFailureCount { get; set; }
        
        public int SimulatedFailureCount { get; set; }
        
        public string? SimulationSummary { get; set; }
        
        public DateTime RunAt { get; set; } = DateTime.UtcNow;
    }

    public class OperationLog
    {
        [Key]
        public Guid Id { get; set; }
        
        public Guid SessionId { get; set; }
        
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        
        [MaxLength(20)]
        public string Level { get; set; } = "INFO"; // INFO, SUCCESS, WARNING, ERROR
        
        [MaxLength(50)]
        public string Source { get; set; } = "Scenario"; // Dynatrace, Gemini, OTel, Gateway, Scenario
        
        [Required]
        public string Message { get; set; } = string.Empty;
    }
}
