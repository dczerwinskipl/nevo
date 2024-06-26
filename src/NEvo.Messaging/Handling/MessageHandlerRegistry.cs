﻿using NEvo.Messaging.Handling.Exceptions;
using System.Collections.Concurrent;

namespace NEvo.Messaging.Handling;

public class MessageHandlerRegistry(IMessageHandlerExtractor messageHandlerExtractor) : IMessageHandlerRegistry
{
    private readonly ConcurrentDictionary<Type, List<IMessageHandler>> _handlers = new();

    private readonly IMessageHandlerExtractor _messageHandlerExtractor = messageHandlerExtractor;

    public void Register<THandler>()
    {
        var handlers = _messageHandlerExtractor.ExtractMessageHandlers<THandler>();
        foreach (var (Key, Value) in handlers)
        {
            var messageHandlers = _handlers.GetOrAdd(Key, []);
            messageHandlers.Add(Value);
        }
    }

    public Either<Exception, IMessageHandler> GetMessageHandler(Type messageType) =>
        _handlers.TryGetValue(messageType, out var handlers)
            ? SelectMessageHandler(messageType, handlers)
            : new NoHandlerFoundException(messageType);

    public Either<Exception, IMessageHandler> GetMessageHandler<TResult>(Type messageType) =>
        GetMessageHandler(messageType)
            .Bind(handler =>
                handler.ReturnsSpecifiedType(typeof(TResult))
                    ? Prelude.Right<Exception, IMessageHandler>(handler)
                    : new InvalidReturnTypeException(messageType, typeof(TResult), handler.HandlerDescription.ReturnType)
            );

    public IEnumerable<IMessageHandler> GetMessageHandlers(Type messageType) =>
        _handlers.TryGetValue(messageType, out var handlers)
            ? handlers
            : Enumerable.Empty<IMessageHandler>();

    private static Either<Exception, IMessageHandler> SelectMessageHandler(Type messageType, List<IMessageHandler> handlers) =>
        handlers.Count > 1
            ? new MoreThanOneHandlerFoundException(messageType, handlers.Select(h => h.HandlerDescription))
            : Prelude.Right<Exception, IMessageHandler>(handlers.Single());
}
