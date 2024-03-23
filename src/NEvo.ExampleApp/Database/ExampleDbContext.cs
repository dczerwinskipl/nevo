using Microsoft.EntityFrameworkCore;
using NEvo.Messaging.EntityFramework;
using NEvo.Messaging.EntityFramework.Configurations;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.ExampleApp.Database;

public class ExampleDbContext : DbContext, IInboxDbContext, IOutboxDbContext
{
    public DbSet<InboxProcessedHandler> InboxProcessedHandlers { get; set; }
    public DbSet<InboxProcessedMessage> InboxProcessedMessages { get; set; }
    public DbSet<OutboxMessage> OutboxMessages { get; set; }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.UseSqlServer(@"Data Source=(localdb)\MSSQLLocalDB;Initial Catalog=ExampleDb;Integrated Security=True;Connect Timeout=30;Encrypt=False;Trust Server Certificate=False;Application Intent=ReadWrite;Multi Subnet Failover=False;");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyInboxConfiguration();
        modelBuilder.ApplyOutboxConfiguration();
    }
}
