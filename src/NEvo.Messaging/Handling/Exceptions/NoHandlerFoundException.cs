using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public class NoHandlerFoundException(Type messageType) : MessageHandlerRegistryException($"No handler found for message type: {messageType.Name}")
{
    public Type MessageType { get; } = messageType;
}
