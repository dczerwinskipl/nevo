using NEvo.Core;
using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Events;

public class ParallelEventProcessingStrategy : EventProcessingStrategyBase
{
    public ParallelEventProcessingStrategy(
        IMessageHandlerRegistry messageHandlerRegistry,
        IMiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>> messageProcessingMiddleware
    ) : base(messageHandlerRegistry, messageProcessingMiddleware)
    {
    }

    public ParallelEventProcessingStrategy(
       IMessageHandlerRegistry messageHandlerRegistry,
       IEnumerable<MessageProcessingHandlerMiddlewareConfig> messageProcessingHandlerMiddlewares
    ) : base(
        messageHandlerRegistry,
        new MiddlewareHandler<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>(messageProcessingHandlerMiddlewares)
    )
    {
    }

    public override bool ShouldApply(IMessage message, IMessageContext context)
        => message is Event && !context.SingleThread;

    protected override async Task<IEnumerable<Either<Exception, Unit>>> HandleAsync(IEnumerable<IMessageHandler> messageHandlers, IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var tasks = messageHandlers.Select(handler => HandleAsync(handler, message, context, cancellationToken)).ToArray();
        return await Task.WhenAll(tasks);
    }
}
