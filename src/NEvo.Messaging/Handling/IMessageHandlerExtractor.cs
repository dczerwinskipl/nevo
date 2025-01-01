namespace NEvo.Messaging.Handling;

public interface IMessageHandlerExtractor
{
    IDictionary<Type, IMessageHandler> ExtractMessageHandlers(Type type);
}
