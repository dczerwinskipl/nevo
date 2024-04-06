using NEvo.Messaging.Context;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;

namespace NEvo.Messaging.Handling;

[ExcludeFromCodeCoverage]
public record MessageHandlerDescription(string Key, Type HandlerType, Type MessageType, Type InterfaceType, Type? ReturnType = null, MethodInfo? Method = null);

public interface IMessageHandler
{
    MessageHandlerDescription HandlerDescription { get; }
    Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);

    [ExcludeFromCodeCoverage]
    bool ReturnsSpecifiedType(Type type)
        => HandlerDescription.ReturnType == type;
}