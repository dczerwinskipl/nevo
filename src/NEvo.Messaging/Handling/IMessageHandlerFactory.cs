namespace NEvo.Messaging.Handling;

public interface IMessageHandlerFactory
{
    public Type ForInterface { get; }
    IMessageHandler Create(MessageHandlerDescription messageHandlerDescription, IServiceProvider serviceProvider);
    IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface);
}
