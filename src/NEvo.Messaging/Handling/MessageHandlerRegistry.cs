using NEvo.Messaging.Handling.Exceptions;
using System.Collections.Concurrent;

namespace NEvo.Messaging.Handling;

public class MessageHandlerRegistry : IMessageHandlerRegistry
{
    private readonly ConcurrentDictionary<Type, List<IMessageHandler>> _handlers = new();

    public MessageHandlerRegistry(IEnumerable<IMessageHandlerProvider> messageHandlerExtractors)
    {
        foreach (var messageHandlerExtractor in messageHandlerExtractors)
        {
            var handlers = messageHandlerExtractor.GetMessageHandlers();
            foreach (var (Key, Value) in handlers)
            {
                var messageHandlers = _handlers.GetOrAdd(Key, []);
                messageHandlers.AddRange(Value);
            }
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

    // Every handler is Primary by default; only the aggregate-method convention route
    // is explicitly Fallback. One Primary always wins over any Fallback present.
    private static Either<Exception, IMessageHandler> SelectMessageHandler(Type messageType, List<IMessageHandler> handlers)
    {
        if (handlers.Count <= 1)
        {
            return Prelude.Right<Exception, IMessageHandler>(handlers.Single());
        }

        var primaries = handlers.Where(h => h.HandlerDescription.Role == HandlerRole.Primary).ToList();
        if (primaries.Count > 1)
        {
            return new MoreThanOneHandlerFoundException(messageType, primaries.Select(h => h.HandlerDescription));
        }

        if (primaries.Count == 1)
        {
            return Prelude.Right<Exception, IMessageHandler>(primaries[0]);
        }

        var fallbacks = handlers.Where(h => h.HandlerDescription.Role == HandlerRole.Fallback).ToList();
        return fallbacks.Count > 1
            ? new MoreThanOneHandlerFoundException(messageType, fallbacks.Select(h => h.HandlerDescription))
            : Prelude.Right<Exception, IMessageHandler>(fallbacks.Single());
    }
}
