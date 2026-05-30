using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using TimeWeave.Backend.Database;
using TimeWeave.Backend.Hubs;

namespace TimeWeave.Backend.Services
{
    public class LogService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IHubContext<ReplayHub> _hubContext;

        public LogService(IServiceScopeFactory scopeFactory, IHubContext<ReplayHub> hubContext)
        {
            _scopeFactory = scopeFactory;
            _hubContext = hubContext;
        }

        public async Task LogAsync(Guid sessionId, string level, string source, string message)
        {
            var log = new OperationLog
            {
                Id = Guid.NewGuid(),
                SessionId = sessionId,
                Timestamp = DateTime.UtcNow,
                Level = level,
                Source = source,
                Message = message
            };

            // Write to database
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                dbContext.OperationLogs.Add(log);
                await dbContext.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LogService] Error saving operation log to DB: {ex.Message}");
            }

            // Broadcast to SignalR group
            try
            {
                await _hubContext.Clients.Group(sessionId.ToString()).SendAsync("ReceiveLog", new
                {
                    id = log.Id,
                    sessionId = log.SessionId,
                    timestamp = log.Timestamp,
                    level = log.Level,
                    source = log.Source,
                    message = log.Message
                });
                Console.WriteLine($"[LogService] Broadcasted log: [{log.Source}] ({log.Level}) {log.Message}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LogService] Error broadcasting log via SignalR: {ex.Message}");
            }
        }
    }
}
