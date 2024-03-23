using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework;

public class EntityFrameworkMessageInbox : IMessageInbox
{
    private IInboxDbContext _dbContext;

    public EntityFrameworkMessageInbox(IInboxDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public bool IsAlreadyProcessed(IMessage message, IMessageContext context) => 
        _dbContext.InboxProcessedMessages.Any(ipm => ipm.MessageId == message.Id);

    public bool IsAlreadyProcessed(IMessageHandler handler, IMessage message, IMessageContext context) =>
        _dbContext.InboxProcessedHandlers.Any(ipm => ipm.MessageId == message.Id && ipm.HandlerKey == handler.HandlerDescription.Key);

    public async Task<Unit> RegisterProcessedAsync(IMessage message, IMessageContext context)
    {
        await _dbContext.InboxProcessedMessages.AddAsync(new InboxProcessedMessage(message.Id, DateTime.UtcNow));
        await _dbContext.SaveChangesAsync();
        return Unit.Default;
    }

    public async Task<Unit> RegisterProcessedAsync(IMessageHandler handler, IMessage message, IMessageContext context)
    {
        await _dbContext.InboxProcessedHandlers.AddAsync(new InboxProcessedHandler(message.Id, handler.HandlerDescription.Key, DateTime.UtcNow));
        await _dbContext.SaveChangesAsync();
        return Unit.Default;
    }
}
