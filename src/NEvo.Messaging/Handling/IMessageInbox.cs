using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling;

public interface IMessageInbox
{
    Task RegisterProcessedAsync(IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessage message, IMessageContext context);

    Task RegisterProcessedAsync(IMessageHandler handler, IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessageHandler handler, IMessage message, IMessageContext context);
}
