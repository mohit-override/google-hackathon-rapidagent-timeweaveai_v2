using Microsoft.EntityFrameworkCore;

namespace TimeWeave.Backend.Database
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }
        
        public DbSet<ReplaySession> ReplaySessions => Set<ReplaySession>();
        public DbSet<TelemetrySpan> TelemetrySpans => Set<TelemetrySpan>();
        public DbSet<SimulationResult> SimulationResults => Set<SimulationResult>();
        public DbSet<OperationLog> OperationLogs => Set<OperationLog>();
        
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<TelemetrySpan>()
                .HasIndex(s => s.SessionId);
                
            modelBuilder.Entity<TelemetrySpan>()
                .HasIndex(s => s.TraceId);
                
            modelBuilder.Entity<SimulationResult>()
                .HasIndex(r => r.SessionId);

            modelBuilder.Entity<OperationLog>()
                .HasIndex(l => l.SessionId);
        }
    }
}
