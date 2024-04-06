using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public class InvalidReturnTypeException(Type messageType, Type expectedReturnType, Type? handlerReturnType) : MessageHandlerRegistryException($"Invalid return type for message handler of type {messageType.Name}. Expected: {expectedReturnType.Name}, Actual: {handlerReturnType?.Name ?? "null"}")
{
    public Type MessageType { get; } = messageType;
    public Type ExpectedReturnType { get; } = expectedReturnType;
    public Type? HandlerReturnType { get; } = handlerReturnType;
}