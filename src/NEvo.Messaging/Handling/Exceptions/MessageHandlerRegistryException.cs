using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public abstract class MessageHandlerRegistryException : Exception
{
    protected MessageHandlerRegistryException(string? message) : base(message)
    {
    }

    protected MessageHandlerRegistryException(string? message, Exception? innerException) : base(message, innerException)
    {
    }
}
