using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework;

public interface IInboxDbContext : IDbContext
{
    DbSet<InboxProcessedMessage> InboxProcessedMessages { get; }
    DbSet<InboxProcessedHandler> InboxProcessedHandlers { get; }
}
