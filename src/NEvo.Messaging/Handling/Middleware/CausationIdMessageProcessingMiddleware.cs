using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public class CausationIdMessageProcessingMiddleware : IMessageProcessingMiddleware
{
    public Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        context.Headers.CausationId.IfNone(() => context.Headers.CausationId = message.Id.ToString());
        return next();
    }
}