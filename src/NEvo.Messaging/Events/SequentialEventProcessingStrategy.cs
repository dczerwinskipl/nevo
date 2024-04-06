using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;
using System.Runtime.CompilerServices;

namespace NEvo.Messaging.Events;

public class SequentialEventProcessingStrategy : EventProcessingStrategyBase
{
    public SequentialEventProcessingStrategy(
        IMessageHandlerRegistry messageHandlerRegistry,
        IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> messageProcessingMiddleware
    ) : base(messageHandlerRegistry, messageProcessingMiddleware)
    {
    }

    public SequentialEventProcessingStrategy(
       IMessageHandlerRegistry messageHandlerRegistry,
       IEnumerable<MessageProcessingHandlerMiddlewareConfig> messageProcessingHandlerMiddlewares
    ) : base(
        messageHandlerRegistry,
        new MiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(messageProcessingHandlerMiddlewares)
    )
    {
    }

    public override bool ShouldApply(IMessage message, IMessageContext context)
        => message is Event && context.SingleThread;

    protected override async Task<IEnumerable<Either<Exception, Unit>>> HandleAsync(IEnumerable<IMessageHandler> messageHandlers, IMessage message, IMessageContext context, CancellationToken cancellationToken)
        => await HandleSequentiallyAsync(messageHandlers, message, context, cancellationToken).ToListAsync(cancellationToken);

    private async IAsyncEnumerable<Either<Exception, Unit>> HandleSequentiallyAsync(IEnumerable<IMessageHandler> messageHandlers, IMessage message, IMessageContext context, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        foreach (var handler in messageHandlers)
        {
            yield return await HandleAsync(handler, message, context, cancellationToken);
        }
    }
}
