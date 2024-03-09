namespace NEvo.Messaging.Handling.Exceptions;

public class NoHandlerFoundException : MessageHandlerRegistryException
{
    public Type MessageType { get; }

    public NoHandlerFoundException(Type messageType)
        : base($"No handler found for message type: {messageType.Name}")
    {
        MessageType = messageType;
    }
}
