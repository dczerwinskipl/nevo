using NEvo.Messaging.Context;
using System.Transactions;

namespace NEvo.Messaging.Handling.Middleware;

public class TransactionScopeMessageProcessingMiddleware() : IMessageProcessingMiddleware
{
    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        //TODO: check if we should use transaction should be used for that message instead of using it always
        //TODO: check mutliple handlers/internal publishing
        context.GetThreadingOptions().ForceSingleThread();
        using var transactionScope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);

        var result = await next();

        result.IfRight(_ => transactionScope.Complete());

        return result;
    }
}