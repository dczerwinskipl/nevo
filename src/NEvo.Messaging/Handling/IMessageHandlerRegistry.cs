using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling;

public interface IMessageHandlerRegistry
{
    void Register(Type type);
    void Register<THandler>();

    Either<Exception, IMessageHandler> GetMessageHandler(Type messageType);
    [ExcludeFromCodeCoverage]
    Either<Exception, IMessageHandler> GetMessageHandler(IMessage message) => GetMessageHandler(message.GetType());

    IEnumerable<IMessageHandler> GetMessageHandlers(Type messageType);
    [ExcludeFromCodeCoverage]
    IEnumerable<IMessageHandler> GetMessageHandlers(IMessage message) => GetMessageHandlers(message.GetType());
}
