using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public class InvalidReturnTypeException : MessageHandlerRegistryException
{
    public Type MessageType { get; }
    public Type ExpectedReturnType { get; }
    public Type? HandlerReturnType { get; }

    public InvalidReturnTypeException(Type messageType, Type expectedReturnType, Type? handlerReturnType)
        : base($"Invalid return type for message handler of type {messageType.Name}. Expected: {expectedReturnType.Name}, Actual: {handlerReturnType?.Name ?? "null"}")
    {
        MessageType = messageType;
        ExpectedReturnType = expectedReturnType;
        HandlerReturnType = handlerReturnType;
    }
}