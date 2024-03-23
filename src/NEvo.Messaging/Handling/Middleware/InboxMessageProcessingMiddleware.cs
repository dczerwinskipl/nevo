using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public class InboxMessageProcessingMiddleware : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    private readonly IMessageInbox _messageInbox;

    public InboxMessageProcessingMiddleware(IMessageInbox messageInbox)
    {
        _messageInbox = Check.Null(messageInbox);
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        if (_messageInbox.IsAlreadyProcessed(message, context))
            return Unit.Default;

        return await next().MapAsync(
           async successResult => 
           {
               await _messageInbox.RegisterProcessedAsync(message, context);
               return successResult;
           }
        );
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler handler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        if (_messageInbox.IsAlreadyProcessed(handler, message, context))
            return Unit.Default;

        return await next().MapAsync(
           async successResult => 
           {
               await _messageInbox.RegisterProcessedAsync(message, context);
               return successResult;
           }
        );
    }
}
