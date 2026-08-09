using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Queries;

public class QueryDispatcher(
    IMessageProcessor messageProcessor,
    IMessageContextAccessor messageContextAccessor,
    IMessageContextProvider messageContextProvider
) : IQueryDispatcher
{
    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(Query<TResult> query, CancellationToken cancellationToken)
    {
        messageContextAccessor.MessageContext ??= messageContextProvider.CreateContext();

        return messageProcessor.ProcessMessageAsync(query, messageContextAccessor.MessageContext, cancellationToken);
    }
}
