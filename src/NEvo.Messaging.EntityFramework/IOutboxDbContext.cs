using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework;

public interface IOutboxDbContext : IDbContext
{
    DbSet<OutboxMessage> OutboxMessages { get; }
}
