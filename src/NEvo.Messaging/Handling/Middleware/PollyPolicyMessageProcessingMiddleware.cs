using LanguageExt;
using Polly;

namespace NEvo.Messaging.Handling.Middleware;

// TODO: move to NEvo.Messaging.Polly?

public interface IPollyMessageHandlingPolicyProvider
{
    public Policy<Task<Either<Exception, object>>> For(IMessageHandler handler, IMessage message, IMessageContext context);
}

public class PollyPolicyMessageProcessingMiddleware : IMessageProcessingHandlerMiddleware
{
    private readonly IPollyMessageHandlingPolicyProvider _messageHandlingPolicyProvider;

    public PollyPolicyMessageProcessingMiddleware(IPollyMessageHandlingPolicyProvider messageHandlingPolicyProvider)
    {
        _messageHandlingPolicyProvider = messageHandlingPolicyProvider;
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler handler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var policy = _messageHandlingPolicyProvider.For(handler, message, context);
        return await policy.Execute(next);
    }
}
