namespace NEvo.Messaging.Handling;

public interface IMessageHandlerFactory
{
    bool CanApply(Type handlerType);
    IMessageHandler Create(MessageHandlerDescription messageHandlerDescription);
    IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType);
}
