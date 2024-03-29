﻿using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Exceptions;

[ExcludeFromCodeCoverage]
public class MoreThanOneHandlerFoundException : MessageHandlerRegistryException
{
    public Type MessageType { get; }
    public IEnumerable<MessageHandlerDescription> MessageHandlerDescriptions { get; }

    public MoreThanOneHandlerFoundException(Type messageType, IEnumerable<MessageHandlerDescription> messageHandlerDescriptions)
       : base($"More than one handler found for message type: {messageType.Name}. Found handlers: {string.Join(',', messageHandlerDescriptions.Select(mhd => mhd.ToString()))}")
    {
        MessageType = messageType;
        MessageHandlerDescriptions = messageHandlerDescriptions;
    }
}
