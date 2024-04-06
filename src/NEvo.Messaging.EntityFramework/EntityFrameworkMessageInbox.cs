using LanguageExt;
using NEvo.Messaging.Context;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework;

public class EntityFrameworkMessageInbox(IInboxDbContext dbContext) : IMessageInbox
{
    public bool IsAlreadyProcessed(IMessage message, IMessageContext context) =>
        dbContext.InboxProcessedMessages.Any(ipm => ipm.MessageId == message.Id);

    public bool IsAlreadyProcessed(IMessageHandler handler, IMessage message, IMessageContext context) =>
        dbContext.InboxProcessedHandlers.Any(ipm => ipm.MessageId == message.Id && ipm.HandlerKey == handler.HandlerDescription.Key);

    public async Task<Unit> RegisterProcessedAsync(IMessage message, IMessageContext context)
    {
        await dbContext.InboxProcessedMessages.AddAsync(new InboxProcessedMessage(message.Id, DateTime.UtcNow));
        await dbContext.SaveChangesAsync();
        return Unit.Default;
    }

    public async Task<Unit> RegisterProcessedAsync(IMessageHandler handler, IMessage message, IMessageContext context)
    {
        await dbContext.InboxProcessedHandlers.AddAsync(new InboxProcessedHandler(message.Id, handler.HandlerDescription.Key, DateTime.UtcNow));
        await dbContext.SaveChangesAsync();
        return Unit.Default;
    }
}
