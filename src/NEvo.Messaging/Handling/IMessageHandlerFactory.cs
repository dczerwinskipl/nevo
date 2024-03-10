namespace NEvo.Messaging.Handling;

public interface IMessageHandlerFactory
{
    public Type ForInterface { get; }
    IMessageHandler Create(MessageHandlerDescription messageHandlerDescription);
    IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface);
}
