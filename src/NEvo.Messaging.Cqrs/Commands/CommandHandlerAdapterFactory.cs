using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Commands;

public class CommandHandlerAdapterFactory : IMessageHandlerFactory
{
    public static Type ForInterface => typeof(ICommandHandler<>);

    public bool CanApply(Type handlerType)
        => handlerType
            .GetInterfaces()
            .Any(handlerInterface => handlerInterface.IsGenericType && handlerInterface.GetGenericTypeDefinition() == ForInterface);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new CommandHandlerAdapter(messageHandlerDescription);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType)
    {
        var handlerInterfaces = handlerType
            .GetInterfaces()
            .Where(handlerInterface => handlerInterface.IsGenericType && handlerInterface.GetGenericTypeDefinition() == ForInterface);

        foreach (var handlerInterface in handlerInterfaces)
        {
            yield return new MessageHandlerDescription(
                Key: $"{handlerType.FullName}-{handlerInterface.GetGenericArguments()[0]}",
                HandlerType: handlerType,
                MessageType: handlerInterface.GetGenericArguments()[0],
                InterfaceType: handlerInterface,
                ReturnType: typeof(Unit),
                Method: handlerType.GetInterfaceMap(handlerInterface).TargetMethods.First(m => m.Name == nameof(ICommandHandler<Command>.HandleAsync))
            );
        }
    }
}
