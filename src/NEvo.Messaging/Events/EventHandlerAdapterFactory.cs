﻿using Microsoft.Extensions.Logging;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Events;

public class EventHandlerAdapterFactory(ILogger<EventHandlerAdapter> eventHandlerLogger) : IMessageHandlerFactory
{
    public static Type ForInterface => typeof(IEventHandler<>);

    public bool CanApply(Type handlerType)
        => handlerType
            .GetInterfaces()
            .Any(handlerInterface => handlerInterface.IsGenericType && handlerInterface.GetGenericTypeDefinition() == ForInterface);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new EventHandlerAdapter(messageHandlerDescription, eventHandlerLogger);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
    {
        yield return new MessageHandlerDescription(
            Key: $"{handlerType.FullName}-{handlerInterface.GetGenericArguments()[0]}",
            HandlerType: handlerType,
            MessageType: handlerInterface.GetGenericArguments()[0],
            InterfaceType: handlerInterface,
            ReturnType: typeof(Unit),
            Method: handlerType.GetInterfaceMap(handlerInterface).TargetMethods.First(m => m.Name == nameof(IEventHandler<Event>.HandleAsync))
        );
    }

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType)
    {
        throw new NotImplementedException();
    }
}
