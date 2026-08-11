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

    // Role-aware resolution (D3) activates only when at least one candidate for this
    // message type actually carries a Role tag — a message type where every handler is
    // untagged (Query, Event, and every pre-existing Command registration) resolves
    // exactly as before this rule existed. A role-tagged handler mixed with an untagged
    // one for the same message type is not a combination D3 defines a rule for, so it is
    // treated as a conflict rather than silently guessing which one wins.
    private static Either<Exception, IMessageHandler> SelectMessageHandler(Type messageType, List<IMessageHandler> handlers)
    {
        // Count <= 1 never needs to inspect Role — matches pre-D3 behavior exactly, and
        // avoids touching HandlerDescription at all for the single-handler common case.
        if (handlers.Count <= 1)
        {
            return Prelude.Right<Exception, IMessageHandler>(handlers.Single());
        }

        if (!handlers.Any(h => h.HandlerDescription.Role is not null))
        {
            return new MoreThanOneHandlerFoundException(messageType, handlers.Select(h => h.HandlerDescription));
        }

        if (handlers.Any(h => h.HandlerDescription.Role is null))
        {
            return new MoreThanOneHandlerFoundException(messageType, handlers.Select(h => h.HandlerDescription));
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
