using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public class MoreThanOneHandlerFoundException(Type messageType, IEnumerable<MessageHandlerDescription> messageHandlerDescriptions) : MessageHandlerRegistryException($"More than one handler found for message type: {messageType.Name}. Found handlers: {string.Join(',', messageHandlerDescriptions.Select(mhd => mhd.ToString()))}")
{
    public Type MessageType { get; } = messageType;
    public IEnumerable<MessageHandlerDescription> MessageHandlerDescriptions { get; } = messageHandlerDescriptions;
}
