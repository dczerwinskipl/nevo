namespace NEvo.Messaging.Handling;

public interface IMessageHandlerExtractor
{
    IDictionary<Type, IMessageHandler> ExtractMessageHandlers<THandler>();
}
