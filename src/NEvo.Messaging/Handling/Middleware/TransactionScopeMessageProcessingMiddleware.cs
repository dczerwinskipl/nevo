using NEvo.Messaging.Context;
using System.Transactions;

namespace NEvo.Messaging.Handling.Middleware;

public class TransactionScopeMessageProcessingMiddleware() : IMessageProcessingMiddleware
{
    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        //TODO: check if we should use transatction for that message
        using var transactionScope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled);
        var result = await next();
        result.IfRight(_ => transactionScope.Complete());

        return result;
    }
}