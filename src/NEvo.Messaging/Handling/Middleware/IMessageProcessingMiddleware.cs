using NEvo.Core;
using NEvo.Messaging.Context;
using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Handling.Middleware;

public interface IMessageProcessingMiddleware : IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>
{
    Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken);

    [ExcludeFromCodeCoverage]
    Task<Either<Exception, object>> IMiddleware<(IMessage Message, IMessageContext Context), Either<Exception, object>>.ExecuteAsync((IMessage Message, IMessageContext Context) input, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
        => ExecuteAsync(input.Message, input.Context, next, cancellationToken);
}
