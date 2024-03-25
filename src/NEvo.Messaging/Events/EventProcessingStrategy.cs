using Microsoft.Extensions.DependencyInjection;
using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;
using static LanguageExt.Prelude;

namespace NEvo.Messaging.Events;

public class EventProcessingStrategy(
    IMessageHandlerRegistry messageHandlerRegistry,
    IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> messageProcessingMiddleware
) : IMessageProcessingStrategy
{
    private readonly IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> _messageProcessingMiddleware = Check.Null(messageProcessingMiddleware);

    public EventProcessingStrategy(
       IMessageHandlerRegistry messageHandlerRegistry,
       IEnumerable<MessageProcessingHandlerMiddlewareConfig> messageProcessingHandlerMiddlewares
    ) : this(
        messageHandlerRegistry,
        new MiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(messageProcessingHandlerMiddlewares)
    )
    {
    }

    public bool ShouldApply(IMessage message, IMessageContext context) => message is Event;

    public async Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var tasks = messageHandlerRegistry.GetMessageHandlers(message).Select(handler => HandleAsync(handler, message, context, cancellationToken));
        var results = await Task.WhenAll(tasks);
        var failures = results
            .Choose(either => either.Match(
                Left: ex => Some(ex),
                Right: _ => None
            ));

        return failures.Any() ? new AggregateException(failures) : Unit.Default;
    }

    private async Task<Either<Exception, Unit>> HandleAsync(IMessageHandler handler, IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await _messageProcessingMiddleware.ExecuteAsync(
            async (input, cancellationToken) => await handler.HandleAsync(message, context, cancellationToken),
            (handler, message, context),
            cancellationToken
        );

        return result.Map(obj => (Unit)obj);
    }
}
