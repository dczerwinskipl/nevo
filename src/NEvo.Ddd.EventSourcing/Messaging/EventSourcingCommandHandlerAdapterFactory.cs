using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Messaging;

public class EventSourcingCommandHandlerAdapterFactory : IMessageHandlerFactory
{
    public bool CanApply(Type handlerType)
    {
        throw new NotImplementedException();
    }

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new CommandHandlerAdapter(messageHandlerDescription);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
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

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType)
    {
        throw new NotImplementedException();
    }
}
