namespace NEvo.Messaging.Handling;

public interface IMessageHandlerRegistry
{
    Either<Exception, IMessageHandler> GetMessageHandler(Type messageType);
    Either<Exception, IMessageHandler> GetMessageHandler(IMessage message) => GetMessageHandler(message.GetType());

    IEnumerable<IMessageHandler> GetMessageHandlers(Type messageType);
    IEnumerable<IMessageHandler> GetMessageHandlers(IMessage message) => GetMessageHandlers(message.GetType());
}
