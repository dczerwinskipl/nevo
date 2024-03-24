using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging;

public interface IMessageInbox
{
    Task<Unit> RegisterProcessedAsync(IMessage message, IMessageContext context);
    Task<Unit> RegisterProcessedAsync(IMessageHandler handler, IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessageHandler handler, IMessage message, IMessageContext context);
}
