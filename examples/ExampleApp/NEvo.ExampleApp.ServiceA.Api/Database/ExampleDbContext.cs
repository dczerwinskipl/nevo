using Microsoft.EntityFrameworkCore;
using NEvo.Messaging.EntityFramework;
using NEvo.Messaging.EntityFramework.Configurations;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.ExampleApp.ServiceA.Api.Database;

public class ExampleDbContext : DbContext, IInboxDbContext, IOutboxDbContext
{
    public DbSet<InboxProcessedHandler> InboxProcessedHandlers { get; set; }
    public DbSet<InboxProcessedMessage> InboxProcessedMessages { get; set; }
    public DbSet<OutboxMessage> OutboxMessages { get; set; }

    public ExampleDbContext(DbContextOptions<ExampleDbContext> options) : base(options)
    {

    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyInboxConfiguration();
        modelBuilder.ApplyOutboxConfiguration();
    }
}
