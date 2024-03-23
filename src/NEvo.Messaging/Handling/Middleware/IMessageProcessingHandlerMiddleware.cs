using NEvo.Core;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public interface IMessageProcessingHandlerMiddleware : IMiddleware<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>
{

    Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken);

    Task<Either<Exception, object>> IMiddleware<(IMessageHandler MessageHandler, IMessage Message, IMessageContext Context), Either<Exception, object>>.ExecuteAsync((IMessageHandler MessageHandler, IMessage Message, IMessageContext Context) input, CancellationToken cancellationToken, Func<Task<Either<Exception, object>>> next)
        => ExecuteAsync(input.MessageHandler, input.Message, input.Context, next, cancellationToken);
}