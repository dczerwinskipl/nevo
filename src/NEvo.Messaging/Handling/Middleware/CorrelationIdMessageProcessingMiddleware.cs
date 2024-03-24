using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

//TODO correlation Id from Request, etc.
public class CorrelationIdMessageProcessingMiddleware : IMessageProcessingMiddleware
{
    private readonly Guid _correlationId = Guid.NewGuid();

    public Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        context.Headers.CorrelationId.IfNone(() => context.Headers.CorrelationId = _correlationId.ToString());
        return next();
    }
}
