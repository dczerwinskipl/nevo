namespace NEvo.Messaging.Handling;

public interface IMessageInbox
{
    bool RegisterProcessed(IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessage message, IMessageContext context);

    bool RegisterProcessed(IMessageHandler handler, IMessage message, IMessageContext context);
    bool IsAlreadyProcessed(IMessageHandler handler, IMessage message, IMessageContext context);
}
