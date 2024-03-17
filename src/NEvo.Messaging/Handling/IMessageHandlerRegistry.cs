namespace NEvo.Messaging.Handling;

public interface IMessageHandlerRegistry
{
    void Register<THandler>();
    Either<Exception, IMessageHandler> GetMessageHandler(Type messageType);
    Either<Exception, IMessageHandler> GetMessageHandler(IMessage message) => GetMessageHandler(message.GetType());
    IEnumerable<IMessageHandler> GetMessageHandlers(Type messageType);
    IEnumerable<IMessageHandler> GetMessageHandlers(IMessage message) => GetMessageHandlers(message.GetType());

    //TODO revert?
    //Either<Exception, IMessageHandler<TResult>> GetMessageHandler<TResult>(Type messageType);
    //Either<Exception, IMessageHandler<TResult>> GetMessageHandler<TResult>(IMessage message) => GetMessageHandler<TResult>(message.GetType());
}
