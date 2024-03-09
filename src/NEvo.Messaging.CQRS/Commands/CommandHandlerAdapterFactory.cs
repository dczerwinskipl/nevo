using LanguageExt;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.CQRS.Commands;

public class CommandHandlerAdapterFactory : IMessageHandlerFactory
{
    public Type ForInterface => typeof(ICommandHandler<>);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription, IServiceProvider serviceProvider)
        => new CommandHandlerAdapter(messageHandlerDescription, serviceProvider);

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
