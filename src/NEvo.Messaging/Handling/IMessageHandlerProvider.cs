namespace NEvo.Messaging.Handling;

public interface IMessageHandlerProvider
{
    IDictionary<Type, IEnumerable<IMessageHandler>> GetMessageHandlers();
}