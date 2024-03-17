using NEvo.Core;

namespace NEvo.Messaging.Handling.Middleware;

public interface IMessageProcessingMiddleware : IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>
{
    Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken);

    Task<Either<Exception, object>> IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>.ExecuteAsync((IMessage Message, IMessageContext Context) input, CancellationToken cancellationToken, Func<Task<Either<Exception, object>>> next)
        => ExecuteAsync(input.Message, input.Context, next, cancellationToken);
}
