using System.Reflection;

namespace NEvo.Messaging.Handling;

public record MessageHandlerDescription(string Key, Type HandlerType, Type MessageType, Type InterfaceType, Type? ReturnType, MethodInfo? Method);

public interface IMessageHandler
{
    MessageHandlerDescription HandlerDescription { get; }
    Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);
    bool ReturnsSpecifiedType(Type type)
        => HandlerDescription.ReturnType == type;
}