using Microsoft.Extensions.Logging;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandHandlerAdapterFactory(ILogger<MessageHandlerAdapter> logger) : IMessageHandlerFactory
{
    public Type ForInterface => typeof(ICommandHandler<>);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new MessageHandlerAdapter(messageHandlerDescription, logger);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
    {
        yield return new MessageHandlerDescription(
            Key: $"{handlerType.FullName}-{handlerInterface.GetGenericArguments()[0]}",
            HandlerType: handlerType,
            MessageType: handlerInterface.GetGenericArguments()[0],
            InterfaceType: handlerInterface,
            ReturnType: typeof(Unit),
            Method: InterfaceMethodResolver.Resolve(handlerType, handlerInterface, nameof(ICommandHandler<Command>.HandleAsync))
        );
    }
}
