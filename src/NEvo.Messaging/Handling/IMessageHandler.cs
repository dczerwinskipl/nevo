using NEvo.Messaging.Context;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;

namespace NEvo.Messaging.Handling;

/// <summary>
/// <paramref name="InterfaceType"/> is the user-facing handler interface this
/// description was extracted from (e.g. a closed <c>ICommandHandler&lt;T&gt;</c>), or
/// <c>null</c> when the route has no such interface — a convention-generated handler
/// resolved by state/method discovery rather than by implementing a fixed interface.
/// </summary>
[ExcludeFromCodeCoverage]
public record MessageHandlerDescription(string Key, Type HandlerType, Type MessageType, Type? InterfaceType, Type? ReturnType = null, MethodInfo? Method = null)
{
    /// <summary>
    /// Defaults to <see cref="HandlerRole.Primary"/> — only an intentional fallback
    /// registration (the aggregate-method convention route) sets this to
    /// <see cref="HandlerRole.Fallback"/> explicitly.
    /// </summary>
    public HandlerRole Role { get; init; } = HandlerRole.Primary;
}

public interface IMessageHandler
{
    MessageHandlerDescription HandlerDescription { get; }
    Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);

    [ExcludeFromCodeCoverage]
    bool ReturnsSpecifiedType(Type type)
        => HandlerDescription.ReturnType == type;
}