using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using StackExchange.Redis;
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using TimeWeave.Backend.Database;
using TimeWeave.Backend.Hubs;
using TimeWeave.Backend.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000", "http://localhost:8000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Configure Database (PostgreSQL)
var dbConnectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Port=5432;Database=timeweave;Username=postgres;Password=postgres";
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(dbConnectionString));

// Configure Redis Connection
var redisConnectionString = builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
{
    try
    {
        return ConnectionMultiplexer.Connect(redisConnectionString);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Redis] CRITICAL ERROR: Could not connect to Redis at {redisConnectionString}. Exception: {ex.Message}");
        throw;
    }
});

// Register Custom Services
builder.Services.AddHttpClient();
builder.Services.AddSingleton<DynatraceService>();
builder.Services.AddScoped<GeminiService>();
builder.Services.AddScoped<ScenarioService>();
builder.Services.AddSingleton<TelemetryIngestionService>();
builder.Services.AddSingleton<LogService>();

// Register Redis Stream Service (both as singleton and hosted background worker)
builder.Services.AddSingleton<RedisStreamService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<RedisStreamService>());

builder.Services.AddSignalR();

var app = builder.Build();

// Enable CORS
app.UseCors();

// Auto-create database and tables on startup (no migrations needed for lightweight demo deployment)
using (var scope = app.Services.CreateScope())
{
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Console.WriteLine("[Database] Ensuring database and tables exist...");
        await db.Database.EnsureCreatedAsync();
        
        // Execute raw SQL to create OperationLogs table if it doesn't exist
        try
        {
            var createTableSql = @"
                CREATE TABLE IF NOT EXISTS ""OperationLogs"" (
                    ""Id"" UUID PRIMARY KEY,
                    ""SessionId"" UUID NOT NULL,
                    ""Timestamp"" TIMESTAMP WITH TIME ZONE NOT NULL,
                    ""Level"" VARCHAR(20) NOT NULL,
                    ""Source"" VARCHAR(50) NOT NULL,
                    ""Message"" TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ""IX_OperationLogs_SessionId"" ON ""OperationLogs"" (""SessionId"");";
            await db.Database.ExecuteSqlRawAsync(createTableSql);
            Console.WriteLine("[Database] OperationLogs table verified/created.");
        }
        catch (Exception sqlEx)
        {
            Console.WriteLine($"[Database] Error verifying/creating OperationLogs table: {sqlEx.Message}");
        }

        Console.WriteLine("[Database] Database initialized successfully.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Database] Error during database initialization: {ex.Message}");
    }
}

// -------------------------------------------------------------
// MINIMAL APIs
// -------------------------------------------------------------

// Webhook endpoint for OTel Collector trace pushes
app.MapPost("/v1/traces", async (Microsoft.AspNetCore.Http.HttpContext context, TelemetryIngestionService ingestionService) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    await ingestionService.IngestTracesJsonAsync(body);
    return Results.Ok();
});

// Trigger a failure scenario (calls Gateway in background)
app.MapPost("/api/scenarios/trigger", async (string scenario, ScenarioService scenarioService) =>
{
    if (string.IsNullOrWhiteSpace(scenario))
    {
        return Results.BadRequest(new { error = "Scenario name is required." });
    }
    var session = await scenarioService.TriggerScenarioAsync(scenario);
    return Results.Ok(session);
});

// List all replay sessions
app.MapGet("/api/sessions", async (AppDbContext db) =>
{
    var sessions = await db.ReplaySessions.OrderByDescending(s => s.TriggeredAt).ToListAsync();
    return Results.Ok(sessions);
});

// Fetch spans for a replay session
app.MapGet("/api/sessions/{id}/spans", async (Guid id, AppDbContext db) =>
{
    var spans = await db.TelemetrySpans
        .Where(s => s.SessionId == id)
        .OrderBy(s => s.StartTimeUnixNano)
        .ToListAsync();
    return Results.Ok(spans);
});

// Fetch background logs for a replay session
app.MapGet("/api/sessions/{id}/logs", async (Guid id, AppDbContext db) =>
{
    var logs = await db.OperationLogs
        .Where(l => l.SessionId == id)
        .OrderBy(l => l.Timestamp)
        .ToListAsync();
    return Results.Ok(logs);
});

// Trigger Gemini root-cause analysis report
app.MapPost("/api/sessions/{id}/analyze", async (Guid id, AppDbContext db, GeminiService geminiService) =>
{
    var session = await db.ReplaySessions.FindAsync(id);
    if (session == null) return Results.NotFound();
    
    var spans = await db.TelemetrySpans.Where(s => s.SessionId == id).ToListAsync();
    var analysis = await geminiService.GenerateRootCauseAnalysisAsync(session, spans);
    
    session.GeminiAnalysis = analysis;
    db.ReplaySessions.Update(session);
    await db.SaveChangesAsync();
    
    return Results.Ok(new { id, analysis });
});

// Run counterfactual simulation
app.MapPost("/api/sessions/{id}/simulate", async (Guid id, AppDbContext db, ScenarioService scenarioService) =>
{
    var session = await db.ReplaySessions.FindAsync(id);
    if (session == null) return Results.NotFound();
    
    var result = await scenarioService.RunSimulationAsync(id, session.ScenarioName);
    return Results.Ok(result);
});

// Get simulation results
app.MapGet("/api/sessions/{id}/simulation-results", async (Guid id, AppDbContext db) =>
{
    var results = await db.SimulationResults
        .Where(r => r.SessionId == id)
        .OrderByDescending(r => r.RunAt)
        .ToListAsync();
    return Results.Ok(results);
});

// Dynatrace mock endpoints
app.MapGet("/api/dynatrace/topology", (DynatraceService dtService) =>
{
    return Results.Ok(dtService.GetSmartscapeTopology());
});

app.MapGet("/api/dynatrace/anomalies", (string scenario, DynatraceService dtService) =>
{
    return Results.Ok(dtService.GetActiveAnomalies(scenario));
});

// SignalR route mapping
app.MapHub<ReplayHub>("/hubs/replay");

app.MapGet("/", () => "TimeWeave AI Backend Running.");

app.Run();
