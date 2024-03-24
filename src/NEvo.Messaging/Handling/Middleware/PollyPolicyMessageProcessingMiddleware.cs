using NEvo.Messaging.Context;
using Polly;

namespace NEvo.Messaging.Handling.Middleware;

public interface IPollyMessageHandlingPolicyProvider
{
    public IAsyncPolicy<Either<Exception, object>> For(IMessageHandler handler, IMessage message, IMessageContext context);
}

public class PollyPolicyMessageProcessingMiddleware(IPollyMessageHandlingPolicyProvider messageHandlingPolicyProvider) : IMessageProcessingHandlerMiddleware
{
    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var policy = messageHandlingPolicyProvider.For(messageHandler, message, context);
        return await policy.ExecuteAsync(next);
    }
}
