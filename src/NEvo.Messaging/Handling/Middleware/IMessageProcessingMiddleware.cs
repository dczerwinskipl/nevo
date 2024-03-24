using NEvo.Core;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public interface IMessageProcessingMiddleware : IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>
{
    Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken);

    Task<Either<Exception, object>> IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>.ExecuteAsync((IMessage Message, IMessageContext Context) input, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
        => ExecuteAsync(input.Message, input.Context, next, cancellationToken);
}
