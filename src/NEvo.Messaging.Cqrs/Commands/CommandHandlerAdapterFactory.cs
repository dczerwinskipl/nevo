using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandHandlerAdapterFactory : IMessageHandlerFactory
{
    public Type ForInterface => typeof(ICommandHandler<>);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new CommandHandlerAdapter(messageHandlerDescription);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
    {
        yield return new MessageHandlerDescription(
            Key: $"{handlerType.FullName}-{handlerInterface.GetGenericArguments().First()}",
            HandlerType: handlerType,
            MessageType: handlerInterface.GetGenericArguments().First(),
            InterfaceType: handlerInterface,
            ReturnType: typeof(Unit),
            Method: handlerType.GetInterfaceMap(handlerInterface).TargetMethods.First(m => m.Name == nameof(ICommandHandler<Command>.HandleAsync))
        );
    }
}
